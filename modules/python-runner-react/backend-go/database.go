package main

import (
	"context"
	_ "embed"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/001_python_runner_init.sql
var initialSchema string

const initialVersion = "001_python_runner_init"

func recoverInterruptedExecutions(ctx context.Context, pool *pgxpool.Pool) error {
	return pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE pr_executions SET status='stopped',finished_at=NOW(),updated_at=NOW()
			WHERE status IN ('pending','running')`); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `UPDATE pr_scheduled_tasks SET status=CASE WHEN enabled THEN 'enabled' ELSE 'disabled' END,
			updated_at=NOW() WHERE status='running'`)
		return err
	})
}

func openDatabase(ctx context.Context, c config) (*pgxpool.Pool, error) {
	settings, err := pgxpool.ParseConfig(c.databaseURL)
	if err != nil {
		return nil, fmt.Errorf("invalid module database configuration")
	}
	settings.MaxConns = int32(c.poolSize)
	settings.MaxConnIdleTime = 30 * time.Second
	settings.ConnConfig.ConnectTimeout = 5 * time.Second
	settings.ConnConfig.RuntimeParams["search_path"] = pgx.Identifier{c.databaseSchema}.Sanitize()
	pool, err := pgxpool.NewWithConfig(ctx, settings)
	if err != nil {
		return nil, err
	}
	if err = migrateDatabase(ctx, pool, c.databaseSchema); err != nil {
		pool.Close()
		return nil, fmt.Errorf("initialize Python Runner database: %w", err)
	}
	return pool, nil
}

func migrateDatabase(ctx context.Context, pool *pgxpool.Pool, schema string) error {
	return pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		// Serialize first-time setup for this module schema.
		if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtext('toolnest:python-runner'), hashtext($1))", schema); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, "CREATE SCHEMA IF NOT EXISTS "+pgx.Identifier{schema}.Sanitize()); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `CREATE TABLE IF NOT EXISTS pr_schema_migrations (
			version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`); err != nil {
			return err
		}
		var applied bool
		if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM pr_schema_migrations WHERE version = $1)", initialVersion).Scan(&applied); err != nil {
			return err
		}
		if applied {
			return nil
		}
		if _, err := tx.Exec(ctx, initialSchema); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, "INSERT INTO pr_schema_migrations(version) VALUES ($1)", initialVersion)
		return err
	})
}
