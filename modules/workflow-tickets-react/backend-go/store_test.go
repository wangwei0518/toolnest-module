package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func TestRepositoryUpgradeAndAtomicUpdates(t *testing.T) {
	databaseURL := os.Getenv("TOOLNEST_WORKFLOW_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set TOOLNEST_WORKFLOW_TEST_DATABASE_URL to an isolated PostgreSQL database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	schema := "workflow_test_" + strconv.FormatInt(time.Now().UnixNano(), 10)
	conn, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := conn.Exec(cleanup, "DROP SCHEMA IF EXISTS "+pgx.Identifier{schema}.Sanitize()+" CASCADE"); err != nil {
			t.Error(err)
		}
		_ = conn.Close(cleanup)
	})
	if _, err := conn.Exec(ctx, "CREATE SCHEMA "+pgx.Identifier{schema}.Sanitize()); err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Exec(ctx, "SET search_path TO "+pgx.Identifier{schema}.Sanitize()); err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Exec(ctx, schemaSQL, pgx.QueryExecModeSimpleProtocol); err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Exec(ctx, `INSERT INTO workflow_tickets_entities (collection,entity_id,ordinal,payload) VALUES
		('tickets','ticket-old',0,'{"id":"ticket-old","status":"completed","extra":{"large":9007199254740993}}'),
		('schedules','monthly',0,'{"id":"monthly","timezone":"Asia/Shanghai","run_count":0,"next_run_at":"2026-11-02T02:00:00.000Z"}'),
		('future_collection','future-id',0,'{"id":"future-id"}')`); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "workflow-store.json"), []byte(`{"tickets":[{"id":"legacy-only"}]}`), 0600); err != nil {
		t.Fatal(err)
	}
	limits := historyLimits{timeline: 2, actionExecutions: 2, scheduleRuns: 2}
	repo, err := openRepository(ctx, databaseURL, schema, dir, 2, limits)
	if err != nil {
		t.Fatal(err)
	}
	defer repo.pool.Close()
	aborted := errors.New("abort update")
	if err := repo.update(ctx, func(state *workflowState) error {
		state.entities["tickets"] = nil
		return aborted
	}); !errors.Is(err, aborted) {
		t.Fatalf("expected rollback, got %v", err)
	}
	var writes sync.WaitGroup
	for i := range 5 {
		writes.Go(func() {
			err := repo.update(ctx, func(state *workflowState) error {
				schedule := state.entities["schedules"][0]
				count, err := schedule["run_count"].(json.Number).Int64()
				if err != nil {
					return err
				}
				schedule["run_count"] = count + 1
				state.entities["schedule_runs"] = append(state.entities["schedule_runs"], record{
					"id": strconv.Itoa(i), "executed_at": time.Date(2026, 11, 2, i, 0, 0, 0, time.UTC).Format(time.RFC3339),
				})
				return nil
			})
			if err != nil {
				t.Error(err)
			}
		})
	}
	writes.Wait()
	if err := repo.read(ctx, func(state *workflowState) error {
		tickets := state.entities["tickets"]
		if len(tickets) != 1 || tickets[0]["id"] != "ticket-old" {
			t.Fatalf("unexpected migrated tickets: %v", tickets)
		}
		if large := tickets[0]["extra"].(map[string]any)["large"]; large != json.Number("9007199254740993") {
			t.Errorf("unexpected preserved field: %v", large)
		}
		schedule := state.entities["schedules"][0]
		if schedule["run_count"] != json.Number("5") || schedule["next_run_at"] != "2026-11-02T02:00:00.000Z" {
			t.Errorf("unexpected schedule: %v", schedule)
		}
		runs := state.entities["schedule_runs"]
		if len(runs) != 2 || runs[0]["id"] != "4" || runs[1]["id"] != "3" {
			t.Errorf("unexpected retained runs: %v", runs)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	var preserved int
	if err := conn.QueryRow(ctx, "SELECT count(*) FROM workflow_tickets_entities WHERE collection='future_collection'").Scan(&preserved); err != nil || preserved != 1 {
		t.Fatalf("future collection was lost: %d, %v", preserved, err)
	}

	freshSchema := schema + "_fresh"
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := conn.Exec(cleanup, "DROP SCHEMA IF EXISTS "+pgx.Identifier{freshSchema}.Sanitize()+" CASCADE"); err != nil {
			t.Error(err)
		}
	})
	fresh, err := openRepository(ctx, databaseURL, freshSchema, dir, 2, limits)
	if err != nil {
		t.Fatal(err)
	}
	defer fresh.pool.Close()
	if err := fresh.read(ctx, func(state *workflowState) error {
		tickets := state.entities["tickets"]
		if len(tickets) != 1 || tickets[0]["id"] != "legacy-only" {
			t.Errorf("legacy state was not imported: %v", tickets)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	t.Run("workflow HTTP contract", func(t *testing.T) {
		exerciseWorkflowAPI(t, fresh)
	})
}
