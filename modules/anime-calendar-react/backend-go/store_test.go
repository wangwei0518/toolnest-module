package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func TestCacheRetentionPrunesOldEntriesWithoutRemovingMarks(t *testing.T) {
	now := time.Date(2026, 10, 21, 0, 0, 0, 0, time.UTC)
	state := new(state)
	state.normalize(now)
	state.Marks["bangumi:975"] = "watching"
	state.Details["expired"] = detailEntry{CachedAt: isoTime(now.AddDate(0, 0, -91))}
	for i := range 510 {
		state.Details[fmt.Sprint(i)] = detailEntry{CachedAt: isoTime(now.Add(-time.Duration(i) * time.Minute))}
	}
	for i := range 2010 {
		state.Notifications[fmt.Sprint(i)] = historyEntry{SentAt: isoTime(now.Add(-time.Duration(i) * time.Minute))}
	}
	for i := range 26 {
		c := courAt(now.AddDate(0, -3*i, 0))
		state.Cours[c.key()] = courCache{cour: c}
	}
	state.normalize(now)
	if len(state.Details) != 500 || len(state.Notifications) != 2000 || len(state.Cours) != 24 ||
		state.Marks["bangumi:975"] != "watching" {
		t.Fatal("cache limits or mark preservation failed")
	}
	if _, found := state.Details["expired"]; found {
		t.Fatal("expired detail survived retention")
	}
	if _, found := state.Cours[courAt(now).key()]; !found {
		t.Fatal("newest quarter was pruned")
	}
}

func TestPostgresLegacyImportAndRollback(t *testing.T) {
	dsn := os.Getenv("ANIME_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("ANIME_TEST_DATABASE_URL is not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	dir := t.TempDir()
	legacy := `{
		"items":[{"id":"bangumi:568244","title_cn":"药屋少女的呢喃 第三季","region":"cn","studio":"OLM Division 2","raw":{"id":568244},"tags":["中国风"]}],
		"marks":{"bangumi:568244":"watching"},
		"settings":{"dataRefreshTime":"05:30"},
		"notificationHistory":{"old":{"sent_at":"2026-10-01T00:00:00.000Z","notification_id":"n1"}}
	}`
	if err := os.WriteFile(filepath.Join(dir, "anime-calendar-state.json"), []byte(legacy), 0600); err != nil {
		t.Fatal(err)
	}
	schema := "anime_test_" + time.Now().UTC().Format("20060102150405_000000000")
	now := func() time.Time { return time.Date(2026, 10, 21, 0, 0, 0, 0, time.UTC) }
	store, err := openStore(ctx, dsn, schema, dir, 1, now)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = store.pool.Exec(cleanup, "DROP SCHEMA "+pgx.Identifier{schema}.Sanitize()+" CASCADE")
		store.pool.Close()
	})
	initial := store.read()
	if len(initial.Items) != 1 || initial.Items[0].Region != "jp" || initial.Marks["bangumi:568244"] != "watching" ||
		initial.Notifications["old"].NotificationID == nil || string(initial.Settings) != `{"dataRefreshTime":"05:30"}` {
		t.Fatalf("legacy import mismatch: %#v", initial)
	}
	_, err = store.pool.Exec(ctx, `ALTER TABLE anime_calendar_entities
		ADD CONSTRAINT test_mark CHECK(collection <> 'marks' OR payload <> '"broken"'::jsonb)`)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.update(ctx, func(next *state) error {
		next.Marks["bangumi:568244"] = "broken"
		return nil
	}); err == nil {
		t.Fatal("expected database constraint failure")
	}
	if store.read() != initial {
		t.Fatal("failed transaction replaced published snapshot")
	}
	if err := store.update(ctx, func(next *state) error {
		next.Marks["bangumi:568244"] = "ignored"
		return nil
	}); err != nil {
		t.Fatalf("write following rollback: %v", err)
	}
	reopened, err := openStore(ctx, dsn, schema, t.TempDir(), 1, now)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.pool.Close()
	if got := reopened.read().Marks["bangumi:568244"]; got != "ignored" {
		t.Fatalf("reloaded mark = %q, want ignored", got)
	}
}
