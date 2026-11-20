package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/jackc/pgx/v5"
)

func recoverPythonEnvironments(ctx context.Context, c config) error {
	if err := prepareDirectories(c); err != nil {
		return err
	}
	startup, cancel := context.WithTimeout(ctx, 12*time.Second)
	pool, err := openDatabase(startup, c)
	cancel()
	if err != nil {
		return err
	}
	defer pool.Close()
	s := projectService{config: c, db: pool}
	rows, err := pool.Query(ctx, `SELECT p.id,e.project_id IS NOT NULL
		FROM pr_projects p LEFT JOIN pr_environment_states e ON p.id=e.project_id
		WHERE p.status<>'deleted' ORDER BY p.id`)
	if err != nil {
		return err
	}
	type candidate struct {
		id             string
		hasEnvironment bool
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (candidate, error) {
		var p candidate
		err := row.Scan(&p.id, &p.hasEnvironment)
		return p, err
	})
	if err != nil {
		return err
	}
	for _, item := range items {
		if id, err := projectRelative(item.id); err != nil || id != item.id || filepath.Base(id) != id {
			return badRequest("项目编号无效。")
		}
		if !item.hasEnvironment {
			if _, err := os.Stat(filepath.Join(s.projectDir(item.id), "venv")); os.IsNotExist(err) {
				continue
			} else if err != nil {
				return err
			}
		}
		p, err := s.get(ctx, item.id)
		if err != nil {
			return err
		}
		scan, err := s.projectScan(ctx, p, true)
		if err != nil {
			return err
		}
		confirmation := securityConfirmation{ID: scan.ID, Confirmed: true}
		if err := scan.require(confirmation, "恢复环境"); err != nil {
			return err
		}
		if err := s.createEnvironment(ctx, p); err != nil {
			return fmt.Errorf("recover environment for %s: %w", p.ID, err)
		}
		if err := s.installRequirements(ctx, p, confirmation); err != nil {
			return fmt.Errorf("recover dependencies for %s: %w", p.ID, err)
		}
	}
	return nil
}
