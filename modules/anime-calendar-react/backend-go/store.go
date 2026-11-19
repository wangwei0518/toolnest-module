package main

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed schema.sql
var schemaSQL string

var schemaName = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

type dataCache struct {
	Date      string      `json:"cache_date"`
	UpdatedAt string      `json:"updated_at"`
	Items     []animeItem `json:"items"`
}

type courCache struct {
	cour
	CandidateStart  *string `json:"candidate_start"`
	CandidateEnd    *string `json:"candidate_end"`
	LastRefreshedAt *string `json:"last_refreshed_at"`
	Status          string  `json:"refresh_status"`
	Fetched         int     `json:"fetched_count"`
	Unique          int     `json:"unique_count"`
	Included        int     `json:"included_count"`
	New             int     `json:"new_this_cour_count"`
	Continuing      int     `json:"continuing_count"`
	LongRunning     int     `json:"long_running_count"`
	Unknown         int     `json:"unknown_count"`
	Skipped         int     `json:"skipped_count"`
	Error           string  `json:"error_message"`
}

type detailEntry struct {
	CachedAt string    `json:"cached_at"`
	Item     animeItem `json:"item"`
}

type historyEntry struct {
	SentAt         string  `json:"sent_at"`
	NotificationID *string `json:"notification_id"`
}

type state struct {
	Items         []animeItem             `json:"items"`
	Marks         map[string]string       `json:"marks"`
	Cours         map[string]courCache    `json:"courCaches"`
	Weekly        *dataCache              `json:"weeklyCache"`
	Today         *dataCache              `json:"todayCache"`
	LongRunning   *dataCache              `json:"longRunningCache"`
	Details       map[string]detailEntry  `json:"detailCache"`
	Settings      json.RawMessage         `json:"settings"`
	Notifications map[string]historyEntry `json:"notificationHistory"`
}

type entityKey struct{ collection, id string }
type entity struct {
	Ordinal int32
	Payload json.RawMessage
}

type postgresStore struct {
	pool    *pgxpool.Pool
	now     func() time.Time
	current atomic.Pointer[state]
	write   sync.Mutex
	saved   map[entityKey]entity
}

func openStore(ctx context.Context, dsn, schema, dataDir string, poolMax int32, now func() time.Time) (*postgresStore, error) {
	if !schemaName.MatchString(schema) {
		return nil, errors.New("invalid PostgreSQL schema name")
	}
	address, err := url.Parse(dsn)
	if err != nil || (address.Scheme != "postgres" && address.Scheme != "postgresql") {
		return nil, errors.New("invalid PostgreSQL connection URL")
	}
	options := address.Query()
	pooler := options.Get("pgbouncer") == "true"
	for _, key := range []string{"schema", "connection_limit", "pgbouncer", "pool_timeout", "socket_timeout"} {
		options.Del(key)
	}
	address.RawQuery = options.Encode()
	cfg, err := pgxpool.ParseConfig(address.String())
	if err != nil {
		return nil, errors.New("invalid PostgreSQL connection configuration")
	}
	if pooler {
		cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeExec
	}
	cfg.MaxConns = poolMax
	cfg.MinConns = 0
	cfg.MaxConnIdleTime = 30 * time.Second
	cfg.ConnConfig.ConnectTimeout = 5 * time.Second
	schemaIdent := pgx.Identifier{schema}.Sanitize()
	cfg.ConnConfig.RuntimeParams["search_path"] = schemaIdent
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	s := &postgresStore{pool: pool, now: now}
	if err := s.load(ctx, schemaIdent, dataDir); err != nil {
		pool.Close()
		return nil, err
	}
	return s, nil
}

func (s *postgresStore) load(ctx context.Context, schema, dataDir string) error {
	if err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "CREATE SCHEMA IF NOT EXISTS "+schema); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, schemaSQL, pgx.QueryExecModeSimpleProtocol)
		return err
	}); err != nil {
		return err
	}
	next := new(state)
	rows, err := s.pool.Query(ctx, "SELECT collection, entity_id, ordinal, payload FROM anime_calendar_entities ORDER BY collection, ordinal, entity_id")
	if err != nil {
		return err
	}
	defer rows.Close()
	next.normalize(s.now())
	saved := make(map[entityKey]entity)
	for rows.Next() {
		var key entityKey
		var row entity
		if err := rows.Scan(&key.collection, &key.id, &row.Ordinal, &row.Payload); err != nil {
			return err
		}
		used, err := next.applyEntity(key, row.Payload)
		if err != nil {
			return fmt.Errorf("decode anime state collection %q: %w", key.collection, err)
		}
		if used {
			saved[key] = row
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	// Valid stores always contain the settings singleton, even if the catalog is empty.
	if len(saved) == 0 {
		payload, err := os.ReadFile(filepath.Join(dataDir, "anime-calendar-state.json"))
		switch {
		case err == nil:
			if err := json.Unmarshal(payload, next); err != nil {
				return fmt.Errorf("decode legacy anime state: %w", err)
			}
		case !errors.Is(err, os.ErrNotExist):
			return err
		}
	}
	next.normalize(s.now())
	next.reclassifyRegions()
	s.saved = saved
	if err := s.persist(ctx, next); err != nil {
		return err
	}
	s.current.Store(next)
	return nil
}

// Readers must treat the published snapshot and its nested values as immutable.
func (s *postgresStore) read() *state { return s.current.Load() }

func (s *postgresStore) update(ctx context.Context, mutate func(*state) error) error {
	s.write.Lock()
	defer s.write.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	payload, err := json.Marshal(s.read())
	if err != nil {
		return err
	}
	next := new(state)
	if err := json.Unmarshal(payload, next); err != nil {
		return err
	}
	if err := mutate(next); err != nil {
		return err
	}
	next.normalize(s.now())
	if err := s.persist(ctx, next); err != nil {
		return err
	}
	s.current.Store(next)
	return nil
}

func (s *postgresStore) persist(ctx context.Context, next *state) error {
	entries, err := next.entities()
	if err != nil {
		return err
	}
	var collections, ids, payloads, staleCollections, staleIDs []string
	var ordinals []int32
	for key, row := range entries {
		previous, found := s.saved[key]
		if !found || previous.Ordinal != row.Ordinal || !bytes.Equal(previous.Payload, row.Payload) {
			collections = append(collections, key.collection)
			ids = append(ids, key.id)
			ordinals = append(ordinals, row.Ordinal)
			payloads = append(payloads, string(row.Payload))
		}
	}
	for key := range s.saved {
		if _, found := entries[key]; !found {
			staleCollections = append(staleCollections, key.collection)
			staleIDs = append(staleIDs, key.id)
		}
	}
	if len(collections)+len(staleIDs) == 0 {
		return nil
	}
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if len(ids) > 0 {
			_, err := tx.Exec(ctx, `
				INSERT INTO anime_calendar_entities AS stored (collection, entity_id, ordinal, payload)
				SELECT collection, entity_id, ordinal, payload::jsonb
				FROM unnest($1::text[], $2::text[], $3::int[], $4::text[]) AS rows(collection, entity_id, ordinal, payload)
				ON CONFLICT (collection, entity_id) DO UPDATE
				SET ordinal = EXCLUDED.ordinal, payload = EXCLUDED.payload, updated_at = now()
				WHERE (stored.ordinal, stored.payload) IS DISTINCT FROM (EXCLUDED.ordinal, EXCLUDED.payload)`,
				collections, ids, ordinals, payloads)
			if err != nil {
				return err
			}
		}
		if len(staleIDs) > 0 {
			_, err := tx.Exec(ctx, `
				DELETE FROM anime_calendar_entities AS stored
				USING unnest($1::text[], $2::text[]) AS stale(collection, entity_id)
				WHERE (stored.collection, stored.entity_id) = (stale.collection, stale.entity_id)`, staleCollections, staleIDs)
			return err
		}
		return nil
	})
	if err == nil {
		s.saved = entries
	}
	return err
}

func (s *state) applyEntity(key entityKey, payload []byte) (bool, error) {
	switch key.collection {
	case "items":
		var item animeItem
		if err := json.Unmarshal(payload, &item); err != nil {
			return true, err
		}
		s.Items = append(s.Items, item)
	case "marks":
		return true, decodeEntry(s.Marks, key.id, payload)
	case "cour_caches":
		return true, decodeEntry(s.Cours, key.id, payload)
	case "detail_cache":
		return true, decodeEntry(s.Details, key.id, payload)
	case "notification_history":
		return true, decodeEntry(s.Notifications, key.id, payload)
	case "singleton":
		switch key.id {
		case "settings":
			return true, json.Unmarshal(payload, &s.Settings)
		case "weekly_cache":
			return true, json.Unmarshal(payload, &s.Weekly)
		case "today_cache":
			return true, json.Unmarshal(payload, &s.Today)
		case "long_running_cache":
			return true, json.Unmarshal(payload, &s.LongRunning)
		default:
			return false, nil
		}
	default:
		return false, nil
	}
	return true, nil
}

func decodeEntry[T any](collection map[string]T, id string, payload []byte) error {
	var value T
	if err := json.Unmarshal(payload, &value); err != nil {
		return err
	}
	collection[id] = value
	return nil
}

func (s *state) entities() (map[entityKey]entity, error) {
	result := make(map[entityKey]entity)
	var encodeErr error
	add := func(collection, id string, ordinal int, value any) {
		payload, err := json.Marshal(value)
		if err != nil {
			encodeErr = err
			return
		}
		result[entityKey{collection, id}] = entity{int32(ordinal), payload}
	}
	for index, item := range s.Items {
		add("items", item.ID, index, item)
	}
	addEntities(add, "marks", s.Marks)
	addEntities(add, "cour_caches", s.Cours)
	addEntities(add, "detail_cache", s.Details)
	addEntities(add, "notification_history", s.Notifications)
	add("singleton", "settings", 0, s.Settings)
	add("singleton", "weekly_cache", 1, s.Weekly)
	add("singleton", "today_cache", 2, s.Today)
	add("singleton", "long_running_cache", 3, s.LongRunning)
	return result, encodeErr
}

func addEntities[T any](add func(string, string, int, any), collection string, values map[string]T) {
	for _, id := range slices.Sorted(maps.Keys(values)) {
		// Only the catalog item's ordinal affects the public ordering.
		add(collection, id, 0, values[id])
	}
}

func (s *state) normalize(now time.Time) {
	if s.Items == nil {
		s.Items = []animeItem{}
	}
	s.Marks = ensureMap(s.Marks)
	s.Cours = ensureMap(s.Cours)
	s.Details = ensureMap(s.Details)
	s.Notifications = ensureMap(s.Notifications)
	retention := struct {
		Days int `json:"cacheRetentionDays"`
	}{90}
	if len(s.Settings) > 0 {
		_ = json.Unmarshal(s.Settings, &retention)
	} else {
		s.Settings = json.RawMessage("{}")
	}
	if retention.Days > 0 {
		cutoff := now.UTC().AddDate(0, 0, -retention.Days)
		maps.DeleteFunc(s.Details, func(_ string, value detailEntry) bool {
			date, err := time.Parse(time.RFC3339Nano, value.CachedAt)
			return err != nil || date.Before(cutoff)
		})
	}
	pruneEntries(s.Details, 500, func(value detailEntry) string { return value.CachedAt })
	pruneEntries(s.Notifications, 2000, func(value historyEntry) string { return value.SentAt })
	pruneEntries(s.Cours, 24, func(value courCache) string { return fmt.Sprintf("%04d-%02d", value.Year, value.Month) })
}

func ensureMap[T any](values map[string]T) map[string]T {
	if values == nil {
		return make(map[string]T)
	}
	return values
}

func pruneEntries[T any](values map[string]T, limit int, sortKey func(T) string) {
	if len(values) <= limit {
		return
	}
	keys := slices.Sorted(maps.Keys(values))
	slices.SortStableFunc(keys, func(a, b string) int {
		return -bytes.Compare([]byte(sortKey(values[a])), []byte(sortKey(values[b])))
	})
	for _, key := range keys[limit:] {
		delete(values, key)
	}
}

func (s *state) reclassifyRegions() {
	known := make(map[string]string)
	collections := [][]animeItem{s.Items}
	for _, cache := range []*dataCache{s.Weekly, s.Today, s.LongRunning} {
		if cache != nil {
			collections = append(collections, cache.Items)
		}
	}
	infer := func(item *animeItem) {
		region := inferRegion(item.Raw, item.Tags, item.Studio)
		if region == "unknown" && len(item.Raw) == 0 && item.Region != "" {
			region = item.Region
		}
		item.Region = region
		if region != "unknown" {
			known[item.ID] = region
		}
	}
	for _, items := range collections {
		for index := range items {
			infer(&items[index])
		}
	}
	for _, id := range slices.Sorted(maps.Keys(s.Details)) {
		entry := s.Details[id]
		infer(&entry.Item)
		s.Details[id] = entry
	}
	fill := func(item *animeItem) {
		if item.Region == "unknown" && known[item.ID] != "" {
			item.Region = known[item.ID]
		}
	}
	for _, items := range collections {
		for index := range items {
			fill(&items[index])
		}
	}
	for id, entry := range s.Details {
		fill(&entry.Item)
		s.Details[id] = entry
	}
}
