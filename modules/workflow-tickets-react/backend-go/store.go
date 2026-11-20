package main

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed schema.sql
var schemaSQL string

var collections = []string{
	"workflows", "tickets", "timeline", "projects", "milestones", "schedule_items",
	"schedules", "schedule_runs", "saved_views", "automations", "resources", "attachments",
	"temporary_resources", "action_executions",
}

type record map[string]any

type workflowState struct {
	entities      map[string][]record
	settings      record
	afterCommit   []func()
	notifications []notificationIntent
}

type historyLimits struct {
	timeline, actionExecutions, scheduleRuns int
}

type repository struct {
	pool     *pgxpool.Pool
	schema   string
	history  historyLimits
	notifier platformNotifications
}

var schemaName = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

func openRepository(ctx context.Context, databaseURL, schema, dataDir string, poolSize int32, limits historyLimits) (*repository, error) {
	if !schemaName.MatchString(schema) || len(schema) > 63 {
		return nil, errors.New("invalid workflow PostgreSQL schema name")
	}
	if poolSize < 1 || limits.timeline < 1 || limits.actionExecutions < 1 || limits.scheduleRuns < 1 {
		return nil, errors.New("workflow pool size and history limits must be positive")
	}
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, err
	}
	config.ConnConfig.ConnectTimeout = 5 * time.Second
	config.ConnConfig.RuntimeParams["search_path"] = pgx.Identifier{schema}.Sanitize()
	config.MaxConns = poolSize
	config.MaxConnIdleTime = 30 * time.Second
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, err
	}
	repo := &repository{pool: pool, schema: schema, history: limits}
	if err := repo.initialize(ctx, dataDir); err != nil {
		pool.Close()
		return nil, err
	}
	return repo, nil
}

func (repo *repository) initialize(ctx context.Context, dataDir string) error {
	return pgx.BeginFunc(ctx, repo.pool, func(tx pgx.Tx) error {
		if err := repo.lockWrites(ctx, tx); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, "CREATE SCHEMA IF NOT EXISTS "+pgx.Identifier{repo.schema}.Sanitize()); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, schemaSQL, pgx.QueryExecModeSimpleProtocol); err != nil {
			return err
		}
		state, before, err := loadState(ctx, tx)
		if err != nil {
			return err
		}
		if len(before.entities) == 0 && len(before.settings) == 0 {
			state, err = loadLegacyState(dataDir)
			if err != nil {
				return err
			}
		}
		state.prune(repo.history)
		return persistState(ctx, tx, before, state)
	})
}

func (repo *repository) lockWrites(ctx context.Context, tx pgx.Tx) error {
	_, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", "toolnest/workflow-tickets/"+repo.schema)
	return err
}

func (repo *repository) read(ctx context.Context, apply func(*workflowState) error) error {
	return pgx.BeginTxFunc(ctx, repo.pool, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		state, _, err := loadState(ctx, tx)
		if err != nil {
			return err
		}
		return apply(state)
	})
}

func (repo *repository) update(ctx context.Context, apply func(*workflowState) error) error {
	var committed []func()
	var notifications []notificationIntent
	err := pgx.BeginFunc(ctx, repo.pool, func(tx pgx.Tx) error {
		if err := repo.lockWrites(ctx, tx); err != nil {
			return err
		}
		state, before, err := loadState(ctx, tx)
		if err != nil {
			return err
		}
		if err := apply(state); err != nil {
			return err
		}
		state.prune(repo.history)
		committed = state.afterCommit
		notifications = state.notifications
		return persistState(ctx, tx, before, state)
	})
	if err == nil {
		for _, effect := range committed {
			effect()
		}
		repo.deliverNotifications(ctx, notifications)
	}
	return err
}

type entityKey struct {
	collection, id string
}

type persistedEntity struct {
	ordinal int
	payload []byte
}

type persistedState struct {
	entities map[entityKey]persistedEntity
	settings []byte
}

func loadState(ctx context.Context, tx pgx.Tx) (*workflowState, persistedState, error) {
	state := newState()
	before := persistedState{entities: make(map[entityKey]persistedEntity)}
	rows, err := tx.Query(ctx, "SELECT collection, entity_id, ordinal, payload FROM workflow_tickets_entities ORDER BY collection, ordinal")
	if err != nil {
		return nil, before, err
	}
	defer rows.Close()
	for rows.Next() {
		var key entityKey
		var entity persistedEntity
		var raw []byte
		if err := rows.Scan(&key.collection, &key.id, &entity.ordinal, &raw); err != nil {
			return nil, before, err
		}
		if _, known := state.entities[key.collection]; !known {
			continue
		}
		var value record
		if err := decodeJSON(raw, &value); err != nil {
			return nil, before, fmt.Errorf("decode %s %q: %w", key.collection, key.id, err)
		}
		if value["id"] != key.id {
			return nil, before, fmt.Errorf("entity ID mismatch in %s %q", key.collection, key.id)
		}
		entity.payload, err = json.Marshal(value)
		if err != nil {
			return nil, before, err
		}
		before.entities[key] = entity
		state.entities[key.collection] = append(state.entities[key.collection], value)
	}
	if err := rows.Err(); err != nil {
		return nil, before, err
	}
	var raw []byte
	err = tx.QueryRow(ctx, "SELECT payload FROM workflow_tickets_settings WHERE singleton = TRUE").Scan(&raw)
	if err == nil {
		var settings record
		if err := decodeJSON(raw, &settings); err != nil {
			return nil, before, err
		}
		before.settings, err = json.Marshal(settings)
		if err != nil {
			return nil, before, err
		}
		state.mergeSettings(settings)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, before, err
	}
	return state, before, nil
}

func persistState(ctx context.Context, tx pgx.Tx, before persistedState, state *workflowState) error {
	batch := &pgx.Batch{}
	seen := make(map[entityKey]struct{})
	for _, collection := range collections {
		for ordinal, value := range state.entities[collection] {
			id, ok := value["id"].(string)
			if !ok || id == "" {
				return fmt.Errorf("%s record at position %d has no ID", collection, ordinal)
			}
			key := entityKey{collection, id}
			if _, duplicate := seen[key]; duplicate {
				return fmt.Errorf("duplicate ID %q in %s", id, collection)
			}
			seen[key] = struct{}{}
			payload, err := json.Marshal(value)
			if err != nil {
				return err
			}
			if old, exists := before.entities[key]; exists && old.ordinal == ordinal && bytes.Equal(old.payload, payload) {
				continue
			}
			batch.Queue(`INSERT INTO workflow_tickets_entities (collection, entity_id, ordinal, payload)
				VALUES ($1, $2, $3, $4::jsonb)
				ON CONFLICT (collection, entity_id) DO UPDATE SET ordinal=EXCLUDED.ordinal,
				payload=EXCLUDED.payload, updated_at=NOW()`, collection, id, ordinal, payload)
		}
	}
	for key := range before.entities {
		if _, retained := seen[key]; !retained {
			batch.Queue("DELETE FROM workflow_tickets_entities WHERE collection=$1 AND entity_id=$2", key.collection, key.id)
		}
	}
	settings, err := json.Marshal(state.settings)
	if err != nil {
		return err
	}
	if !bytes.Equal(settings, before.settings) {
		batch.Queue(`INSERT INTO workflow_tickets_settings (singleton, payload)
			VALUES (TRUE, $1::jsonb)
			ON CONFLICT (singleton) DO UPDATE SET payload=EXCLUDED.payload, updated_at=NOW()`, settings)
	}
	if batch.Len() == 0 {
		return nil
	}
	return tx.SendBatch(ctx, batch).Close()
}

func newState() *workflowState {
	state := &workflowState{entities: make(map[string][]record), settings: record{
		"max_file_size_mb":                json.Number("20"),
		"temporary_resource_days":         json.Number("7"),
		"temporary_resource_access_count": json.Number("3"),
	}}
	for _, key := range collections {
		state.entities[key] = []record{}
	}
	rules := record{}
	for event, level := range map[string]string{
		"ticket_created": "info", "node_ready": "info", "node_completed": "success",
		"ticket_completed": "success", "ticket_blocked": "warning", "ticket_reopened": "info",
		"ticket_cancelled": "warning", "ticket_reminder": "warning", "milestone_due": "warning",
		"project_risk": "warning",
	} {
		rules[event] = record{"enabled": event != "node_completed", "level": level, "channels": []string{"web_internal"}}
	}
	state.settings["notification_rules"] = rules
	return state
}

func (state *workflowState) mergeSettings(settings record) {
	rules := state.settings["notification_rules"].(record)
	for key, value := range settings {
		if key == "notification_rules" {
			if stored, ok := value.(map[string]any); ok {
				for event, rule := range stored {
					rules[event] = rule
				}
				if legacy, ok := stored["node_blocked"]; ok && stored["ticket_blocked"] == nil {
					rules["ticket_blocked"] = legacy
				}
			}
		} else {
			state.settings[key] = value
		}
	}
}

func (state *workflowState) prune(limits historyLimits) {
	for _, item := range []struct {
		collection, timestamp string
		max                   int
	}{
		{"timeline", "created_at", limits.timeline},
		{"action_executions", "created_at", limits.actionExecutions},
		{"schedule_runs", "executed_at", limits.scheduleRuns},
	} {
		entries := state.entities[item.collection]
		sort.SliceStable(entries, func(i, j int) bool {
			left, _ := entries[i][item.timestamp].(string)
			right, _ := entries[j][item.timestamp].(string)
			return left > right
		})
		if len(entries) > item.max {
			state.entities[item.collection] = entries[:item.max]
		}
	}
}

func loadLegacyState(dataDir string) (*workflowState, error) {
	state := newState()
	raw, err := os.ReadFile(filepath.Join(dataDir, "workflow-store.json"))
	if errors.Is(err, os.ErrNotExist) {
		return state, nil
	}
	if err != nil {
		return nil, err
	}
	var legacy map[string]json.RawMessage
	if err := json.Unmarshal(raw, &legacy); err != nil {
		return nil, fmt.Errorf("decode legacy workflow store: %w", err)
	}
	for _, key := range collections {
		if raw, present := legacy[key]; present && string(raw) != "null" {
			var entries []record
			if err := decodeJSON(raw, &entries); err != nil {
				return nil, fmt.Errorf("decode legacy workflow %s: %w", key, err)
			}
			state.entities[key] = entries
		}
	}
	if raw, present := legacy["settings"]; present {
		var settings record
		if err := decodeJSON(raw, &settings); err != nil {
			return nil, err
		}
		state.mergeSettings(settings)
	}
	return state, nil
}

func decodeJSON(raw []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	return decoder.Decode(target)
}
