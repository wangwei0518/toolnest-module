package main

import (
	"archive/zip"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func TestDatabasePreservesExistingMigration(t *testing.T) {
	dsn := os.Getenv("PYTHON_RUNNER_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("requires an isolated PostgreSQL test database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	schema := fmt.Sprintf("pr_test_%d", time.Now().UnixNano())
	identifier := pgx.Identifier{schema}.Sanitize()
	legacy, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer legacy.Close(context.Background())
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := legacy.Exec(cleanup, "DROP SCHEMA IF EXISTS "+identifier+" CASCADE"); err != nil {
			t.Error(err)
		}
	}()
	if _, err := legacy.Exec(ctx, "CREATE SCHEMA "+identifier+"; SET search_path TO "+identifier); err != nil {
		t.Fatal(err)
	}
	if _, err := legacy.Exec(ctx, initialSchema); err != nil {
		t.Fatal(err)
	}
	if _, err := legacy.Exec(ctx, `
		CREATE TABLE pr_schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
		INSERT INTO pr_schema_migrations VALUES ('001_python_runner_init', '2020-01-01T00:00:00Z');
		INSERT INTO pr_projects (id, name) VALUES ('project_existing', '原有项目');
	`); err != nil {
		t.Fatal(err)
	}
	pool, err := openDatabase(ctx, config{databaseURL: dsn, databaseSchema: schema, poolSize: 2})
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	var name string
	if err := pool.QueryRow(ctx, "SELECT name FROM pr_projects WHERE id = 'project_existing'").Scan(&name); err != nil || name != "原有项目" {
		t.Fatalf("legacy project: %q, %v", name, err)
	}
	var applied time.Time
	if err := pool.QueryRow(ctx, "SELECT applied_at FROM pr_schema_migrations WHERE version = $1", initialVersion).Scan(&applied); err != nil || applied.UTC().Year() != 2020 {
		t.Fatalf("original migration timestamp: %v, %v", applied, err)
	}
	if _, err := pool.Exec(ctx, "UPDATE pr_projects SET name = 'Go 更新' WHERE id = 'project_existing'"); err != nil {
		t.Fatal(err)
	}
	if err := legacy.QueryRow(ctx, "SELECT name FROM pr_projects WHERE id = 'project_existing'").Scan(&name); err != nil || name != "Go 更新" {
		t.Fatalf("project after Go update: %q, %v", name, err)
	}
	t.Run("execute and persist output", func(t *testing.T) {
		python, err := exec.LookPath("python3")
		if err != nil {
			t.Skip("requires Python on PATH")
		}
		root := t.TempDir()
		service := executions{
			db: pool, config: config{python: python, dataDir: root, logDir: root, executionSeconds: 30, outputBytes: 1024, concurrentExecutions: 2},
			running: make(map[string]context.CancelFunc),
		}
		raw, err := service.create(ctx, executionInput{
			Name: "验收", Source: executionSource{Type: "inline", Code: "print('第一行')\nprint('第二行')"},
		})
		if err != nil {
			t.Fatal(err)
		}
		var row struct{ ID, Status, Stdout string }
		if err := json.Unmarshal(raw, &row); err != nil || row.Status != "success" || row.Stdout != "第一行\n第二行\n" {
			t.Fatalf("execution result %s: %v", raw, err)
		}
		logFile := filepath.Join(root, "executions", row.ID+".stdout")
		if data, err := os.ReadFile(logFile); err != nil || string(data) != row.Stdout {
			t.Fatalf("stdout file: %q, %v", data, err)
		}
		if entries, err := service.logs(ctx, row.ID, 200, 0); err != nil || len(entries) != 2 || !strings.HasPrefix(entries[1].Content, "第二") {
			t.Fatalf("logs: %v, %v", entries, err)
		}
	})
	t.Run("import scan and execute project", func(t *testing.T) {
		python, err := exec.LookPath("python3")
		if err != nil {
			t.Skip("requires Python on PATH")
		}
		root := t.TempDir()
		c := config{python: python, dataDir: root, logDir: root, executionSeconds: 30, outputBytes: 1024, concurrentExecutions: 2}
		projects := &projectService{config: c, db: pool}
		file, err := os.CreateTemp(root, "*.zip")
		if err != nil {
			t.Fatal(err)
		}
		writer := zip.NewWriter(file)
		entry, err := writer.Create("main.py")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := fmt.Fprint(entry, "import os\nassert os.getenv('TOOLNEST_PLUGIN_TOKEN') is None\nprint('项目输出')"); err != nil {
			t.Fatal(err)
		}
		if err := writer.Close(); err != nil {
			t.Fatal(err)
		}
		if err := file.Close(); err != nil {
			t.Fatal(err)
		}
		upload, err := projects.create(ctx, archiveUpload{temporaryPath: file.Name(), filename: "中文项目.zip"})
		if err != nil || upload.Name != "中文项目" {
			t.Fatalf("upload: %v, %v", upload, err)
		}
		p, err := projects.get(ctx, upload.ID)
		if err != nil {
			t.Fatal(err)
		}
		scan, err := projects.projectScan(ctx, p, false)
		if err != nil || scan.RiskLevel != "medium" {
			t.Fatalf("scan: %v, %v", scan, err)
		}
		current, err := projects.projectScan(ctx, p, true)
		if err != nil || current.ID == scan.ID {
			t.Fatalf("rescan: %v, %v", current, err)
		}
		service := executions{db: pool, config: c, running: make(map[string]context.CancelFunc), prepareArchive: projects.prepareExecution}
		input := executionInput{Source: executionSource{Type: "archive", ProjectID: p.ID}}
		input.Security = securityConfirmation{ID: scan.ID, Confirmed: true}
		if _, err := service.create(ctx, input); err == nil {
			t.Fatal("stale scan confirmation should fail")
		}
		input.Security.ID = current.ID
		raw, err := service.create(ctx, input)
		var result struct{ Status, Stdout string }
		if err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(raw, &result); err != nil || result.Status != "success" || result.Stdout != "项目输出\n" {
			t.Fatalf("project execution: %s, %v", raw, err)
		}
	})
	t.Run("eager scheduler runs without HTTP traffic", func(t *testing.T) {
		python, err := exec.LookPath("python3")
		if err != nil {
			t.Skip("requires Python on PATH")
		}
		root := t.TempDir()
		c := config{python: python, dataDir: root, logDir: root, executionSeconds: 30, outputBytes: 1024, concurrentExecutions: 2}
		e := &executions{db: pool, config: c, running: make(map[string]context.CancelFunc)}
		s := &scheduleService{db: pool, executions: e, projects: &projectService{db: pool, config: c}}
		past := time.Now().Add(-time.Minute).UTC()
		if _, err := pool.Exec(ctx, `INSERT INTO pr_scheduled_tasks
			(id,name,source,schedule_type,run_at,timezone,next_run_at)
			VALUES ('schedule_old','旧定时任务','{"type":"inline","code":"print(42)"}','once',$1,'Asia/Shanghai',$1)`, past); err != nil {
			t.Fatal(err)
		}
		stop := s.start(ctx, 10*time.Millisecond)
		defer e.close()
		defer stop()
		timer := time.NewTimer(3 * time.Second)
		defer timer.Stop()
		tick := time.NewTicker(25 * time.Millisecond)
		defer tick.Stop()
		for {
			var count int
			var status *string
			var next *time.Time
			if err := pool.QueryRow(ctx, "SELECT total_runs,last_status,next_run_at FROM pr_scheduled_tasks WHERE id='schedule_old'").Scan(&count, &status, &next); err != nil {
				t.Fatal(err)
			}
			if count > 0 {
				if count != 1 || status == nil || *status != "success" || next != nil {
					t.Fatalf("once task: runs %d, status %v, next %v", count, status, next)
				}
				break
			}
			select {
			case <-timer.C:
				t.Fatal("scheduled task did not run")
			case <-tick.C:
			}
		}
		stop()
	})
}

func TestScheduleNextTimezone(t *testing.T) {
	expression := "0 8 * * *"
	current := time.Date(2026, 11, 20, 23, 50, 0, 0, time.UTC)
	got, err := scheduleNext("cron", &expression, nil, "Asia/Shanghai", current)
	want := time.Date(2026, 11, 21, 0, 0, 0, 0, time.UTC)
	if err != nil || got == nil || !got.Equal(want) {
		t.Fatalf("08:00 Shanghai: want %v, got %v (%v)", want, got, err)
	}
}
