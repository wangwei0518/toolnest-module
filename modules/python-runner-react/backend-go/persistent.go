package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/text/encoding/unicode"
	"golang.org/x/text/transform"
)

type persistentInput struct {
	Name         string               `json:"name"`
	Description  string               `json:"description"`
	Source       executionSource      `json:"source"`
	Args         []string             `json:"args"`
	Runtime      string               `json:"runtime_environment"`
	Directory    *string              `json:"working_directory"`
	Auto         bool                 `json:"auto_start"`
	Policy       string               `json:"restart_policy"`
	Delay        *int                 `json:"restart_delay_seconds"`
	Max          *int                 `json:"max_restart_count"`
	Notification any                  `json:"notification_config"`
	Security     securityConfirmation `json:"security"`
}

type persistentTask struct {
	ID           string     `json:"id"`
	Name         string     `json:"name"`
	Source       taskSource `json:"source"`
	Args         []string   `json:"args"`
	Runtime      string     `json:"runtime_environment"`
	Directory    *string    `json:"working_directory"`
	Policy       string     `json:"restart_policy"`
	Delay        int        `json:"restart_delay_seconds"`
	Max          int        `json:"max_restart_count"`
	Count        int        `json:"restart_count"`
	Status       string     `json:"status"`
	Notification any        `json:"notification_config"`
}

type persistentProcess struct {
	cancel context.CancelFunc
	done   chan struct{}
}

type persistentService struct {
	config   config
	db       *pgxpool.Pool
	projects *projectService
	notify   notifier
	mu       sync.Mutex
	logMu    sync.Mutex
	active   map[string]*persistentProcess
	restarts map[string]*time.Timer
	closing  bool
	wait     sync.WaitGroup
}

const persistentJSON = `to_jsonb(p) || jsonb_build_object('code','','source_type',source->>'type','source_config',source)`

func (s *persistentService) get(ctx context.Context, id string) (json.RawMessage, error) {
	var data json.RawMessage
	err := s.db.QueryRow(ctx, "SELECT "+persistentJSON+" FROM pr_persistent_tasks p WHERE id=$1", id).Scan(&data)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, notFound("常驻任务不存在。")
	}
	if err != nil {
		return nil, err
	}
	return normalizePersistentRow(data)
}

func normalizePersistentRow(data json.RawMessage) (json.RawMessage, error) {
	var row map[string]any
	if err := json.Unmarshal(data, &row); err != nil {
		return nil, err
	}
	row["notification_config"] = normalizeNotification(row["notification_config"])
	return json.Marshal(row)
}

func (s *persistentService) list(ctx context.Context, keyword, status string, page, size int) (map[string]any, error) {
	const where = ` WHERE ($1='' OR name ILIKE '%'||$1||'%') AND ($2='' OR status=$2)`
	var total int64
	if err := s.db.QueryRow(ctx, "SELECT COUNT(*) FROM pr_persistent_tasks"+where, keyword, status).Scan(&total); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx, "SELECT "+persistentJSON+" FROM pr_persistent_tasks p"+where+" ORDER BY created_at DESC LIMIT $3 OFFSET $4",
		keyword, status, size, int64(page-1)*int64(size))
	if err != nil {
		return nil, err
	}
	items, err := pgx.AppendRows([]json.RawMessage{}, rows, func(row pgx.CollectableRow) (json.RawMessage, error) {
		var raw json.RawMessage
		if err := row.Scan(&raw); err != nil {
			return nil, err
		}
		return normalizePersistentRow(raw)
	})
	return map[string]any{"items": items, "total": total, "page": page, "page_size": size}, err
}

func (s *persistentService) save(ctx context.Context, id string, input persistentInput) (json.RawMessage, error) {
	name := []rune(strings.TrimSpace(input.Name))
	if len(name) == 0 {
		return nil, badRequest("常驻任务名称不能为空。")
	}
	if input.Source.Type != "archive" {
		return nil, badRequest("常驻任务必须绑定项目源码。")
	}
	description := []rune(strings.TrimSpace(input.Description))
	if input.Args == nil {
		input.Args = []string{}
	}
	if err := validateArgs(input.Args); err != nil {
		return nil, err
	}
	if input.Runtime == "" {
		input.Runtime = "project_venv"
	}
	if input.Policy == "" {
		input.Policy = "never"
	}
	if !slices.Contains([]string{"auto", "system", "project_venv"}, input.Runtime) ||
		!slices.Contains([]string{"never", "on_failure", "always"}, input.Policy) {
		return nil, badRequest("常驻任务的运行环境或重启策略无效。")
	}
	delay, maximum := 5, 3
	if input.Delay != nil {
		delay = min(3600, max(0, *input.Delay))
	}
	if input.Max != nil {
		maximum = min(100, max(0, *input.Max))
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	action := "创建常驻任务"
	if id != "" {
		action = "更新常驻任务"
	}
	if err := s.projects.confirmSource(ctx, input.Source, input.Security, action); err != nil {
		return nil, err
	}
	args := []any{string(name[:min(len(name), 120)]), string(description[:min(len(description), 500)]),
		taskSource{input.Source, input.Security}, input.Args, input.Runtime, input.Directory, input.Auto, input.Policy, delay, maximum,
		normalizeNotification(input.Notification)}
	var err error
	if id == "" {
		id = newID("persistent")
		_, err = s.db.Exec(ctx, `INSERT INTO pr_persistent_tasks
			(name,description,source,args,runtime_environment,working_directory,auto_start,restart_policy,restart_delay_seconds,max_restart_count,notification_config,id)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, append(args, id)...)
	} else {
		if _, err := s.get(ctx, id); err != nil {
			return nil, err
		}
		if s.active[id] != nil || s.restarts[id] != nil {
			if err := s.stopLocked(ctx, id); err != nil {
				return nil, err
			}
		}
		_, err = s.db.Exec(ctx, `UPDATE pr_persistent_tasks SET name=$1,description=$2,source=$3,args=$4,runtime_environment=$5,
			working_directory=$6,auto_start=$7,restart_policy=$8,restart_delay_seconds=$9,max_restart_count=$10,
			notification_config=$11,updated_at=NOW() WHERE id=$12`, append(args, id)...)
	}
	if err != nil {
		return nil, err
	}
	if input.Auto {
		if err := s.startLocked(ctx, id); err != nil {
			return nil, err
		}
	}
	return s.get(ctx, id)
}

func (s *persistentService) initialize(ctx context.Context) error {
	if _, err := s.db.Exec(ctx, `UPDATE pr_persistent_tasks SET status='stopped',pid=NULL,stopped_at=NOW(),updated_at=NOW()
		WHERE status='running'`); err != nil {
		return err
	}
	rows, err := s.db.Query(ctx, "SELECT id FROM pr_persistent_tasks WHERE auto_start=TRUE")
	if err != nil {
		return err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return err
	}
	s.wait.Go(func() {
		for _, id := range ids {
			if ctx.Err() != nil {
				return
			}
			attempt, cancel := context.WithTimeout(ctx, 30*time.Second)
			_, err := s.control(attempt, id, "start")
			cancel()
			if err != nil && ctx.Err() == nil {
				log.Printf("auto-start Python task %s: %v", id, err)
			}
		}
	})
	return nil
}

func (s *persistentService) startLocked(ctx context.Context, id string) error {
	if s.closing {
		return &requestError{status: 503, message: "模块正在关闭。"}
	}
	if s.active[id] != nil {
		return nil
	}
	s.cancelRestartLocked(id)
	raw, err := s.get(ctx, id)
	if err != nil {
		return err
	}
	var task persistentTask
	if err := json.Unmarshal(raw, &task); err != nil {
		return err
	}
	if err := validateArgs(task.Args); err != nil {
		return err
	}
	if _, err := taskPath(id); err != nil {
		return err
	}
	base, err := os.OpenRoot(s.config.dataDir)
	if err != nil {
		return err
	}
	defer base.Close()
	relative := "persistent/" + id
	if err := base.RemoveAll(relative); err != nil {
		return err
	}
	if err := base.MkdirAll(relative, 0700); err != nil {
		return err
	}
	workspace := filepath.Join(s.config.dataDir, filepath.FromSlash(relative))
	prepared, err := s.projects.prepareExecution(ctx, executionInput{
		Source: task.Source.executionSource, Security: task.Source.Security, Runtime: task.Runtime,
	}, workspace)
	if err != nil {
		return err
	}
	cwd := workspace
	if task.Directory != nil && strings.TrimSpace(*task.Directory) != "" {
		dir, err := projectRelative(*task.Directory)
		if err != nil {
			return err
		}
		cwd = filepath.Join(workspace, filepath.FromSlash(dir))
	}
	if info, err := os.Stat(cwd); err != nil || !info.IsDir() {
		return badRequest("常驻任务工作目录不存在。")
	}
	filename := s.logPath(id)
	if err := os.MkdirAll(filepath.Dir(filename), 0700); err != nil {
		return err
	}
	processCtx, cancel := context.WithCancel(context.WithoutCancel(ctx))
	active := &persistentProcess{cancel: cancel, done: make(chan struct{})}
	cmd := pythonCommand(processCtx, prepared.interpreter, cwd,
		slices.Concat([]string{filepath.Join(workspace, filepath.FromSlash(prepared.entry))}, task.Args),
		pythonEnvironment("TOOLNEST_EXECUTION_ID="+id, "TOOLNEST_EXECUTION_WORKSPACE="+workspace))
	sink := persistentOutput{s: s, filename: filename}
	stdout := transform.NewWriter(sink, unicode.UTF8.NewDecoder())
	stderr := transform.NewWriter(sink, unicode.UTF8.NewDecoder())
	cmd.Stdout, cmd.Stderr = stdout, stderr
	if err := cmd.Start(); err != nil {
		cancel()
		return badRequest("启动常驻任务失败：" + err.Error())
	}
	recordCtx, finish := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer finish()
	err = pgx.BeginFunc(recordCtx, s.db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(recordCtx, `UPDATE pr_persistent_tasks SET status='running',pid=$1,started_at=NOW(),
			stopped_at=NULL,last_heartbeat_at=NOW(),last_error=NULL,updated_at=NOW() WHERE id=$2`, cmd.Process.Pid, id); err != nil {
			return err
		}
		return persistentEvent(recordCtx, tx, id, "started", task.Status, "running", "常驻任务已启动", nil, nil)
	})
	if err != nil {
		cancel()
		_ = cmd.Wait()
		return err
	}
	s.active[id] = active
	s.wait.Go(func() {
		defer cancel()
		runErr := cmd.Wait()
		_ = stdout.Close()
		_ = stderr.Close()
		close(active.done)
		s.onExit(task, active, cmd, runErr)
	})
	return nil
}

func taskPath(id string) (string, error) {
	value, err := projectRelative(id)
	if err != nil || value != id || strings.Contains(value, "/") {
		return "", badRequest("常驻任务编号无效。")
	}
	return value, nil
}

func (s *persistentService) cancelRestartLocked(id string) {
	if timer := s.restarts[id]; timer != nil {
		timer.Stop()
		delete(s.restarts, id)
	}
}

func (s *persistentService) stopLocked(ctx context.Context, id string) error {
	s.cancelRestartLocked(id)
	active := s.active[id]
	if active != nil {
		delete(s.active, id)
		active.cancel()
		<-active.done
	}
	persist, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	return pgx.BeginFunc(persist, s.db, func(tx pgx.Tx) error {
		tag, err := tx.Exec(persist, "UPDATE pr_persistent_tasks SET status='stopped',stopped_at=NOW(),pid=NULL,updated_at=NOW() WHERE id=$1", id)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return notFound("常驻任务不存在。")
		}
		if active != nil {
			return persistentEvent(persist, tx, id, "stopped", "running", "stopped", "常驻任务已停止", nil, nil)
		}
		return nil
	})
}

func (s *persistentService) control(ctx context.Context, id, action string) (json.RawMessage, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if action == "stop" || action == "restart" {
		if err := s.stopLocked(ctx, id); err != nil {
			return nil, err
		}
	}
	if action == "start" || action == "restart" {
		if err := s.startLocked(ctx, id); err != nil {
			return nil, err
		}
	}
	return s.get(ctx, id)
}

func (s *persistentService) remove(ctx context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.active[id] != nil || s.restarts[id] != nil {
		if err := s.stopLocked(ctx, id); err != nil {
			return err
		}
	}
	tag, err := s.db.Exec(ctx, "DELETE FROM pr_persistent_tasks WHERE id=$1", id)
	if err == nil && tag.RowsAffected() == 0 {
		return notFound("常驻任务不存在。")
	}
	return err
}

func (s *persistentService) close() {
	s.mu.Lock()
	s.closing = true
	for id := range s.restarts {
		s.cancelRestartLocked(id)
	}
	items := make(map[string]*persistentProcess, len(s.active))
	for id, active := range s.active {
		items[id] = active
		active.cancel()
	}
	for id := range items {
		if err := s.stopLocked(context.Background(), id); err != nil {
			log.Printf("stop Python task %s: %v", id, err)
		}
	}
	s.mu.Unlock()
	s.wait.Wait()
}

func (s *persistentService) onExit(task persistentTask, active *persistentProcess, cmd *exec.Cmd, runErr error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	failed := runErr != nil
	status := "stopped"
	var exit *int
	if code := cmd.ProcessState.ExitCode(); code >= 0 {
		exit = &code
	}
	var cause *string
	if failed {
		status = "failed"
		message := "进程异常退出"
		cause = &message
	}
	s.mu.Lock()
	if s.active[task.ID] != active {
		s.mu.Unlock()
		return
	}
	delete(s.active, task.ID)
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE pr_persistent_tasks SET status=$1,pid=NULL,stopped_at=NOW(),last_exit_code=$2,last_error=$3,
			restart_count=restart_count+CASE WHEN $4 THEN 1 ELSE 0 END,updated_at=NOW() WHERE id=$5`,
			status, exit, cause, failed || task.Policy == "always", task.ID); err != nil {
			return err
		}
		return persistentEvent(ctx, tx, task.ID, status, "running", status, "常驻任务进程已退出", exit, cause)
	})
	if err == nil && !s.closing && task.Count < task.Max && (task.Policy == "always" || (task.Policy == "on_failure" && failed)) {
		var timer *time.Timer
		timer = time.AfterFunc(time.Duration(task.Delay)*time.Second, func() {
			s.mu.Lock()
			defer s.mu.Unlock()
			if s.restarts[task.ID] != timer || s.closing {
				return
			}
			delete(s.restarts, task.ID)
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			if err := s.startLocked(ctx, task.ID); err != nil {
				log.Printf("restart Python task %s: %v", task.ID, err)
			}
		})
		s.restarts[task.ID] = timer
	}
	s.mu.Unlock()
	if err != nil {
		log.Printf("finalize Python task %s: %v", task.ID, err)
		return
	}
	content, _, _ := readTail(s.logPath(task.ID), persistentLogLimit)
	runStatus := "success"
	if failed {
		runStatus = "failed"
	}
	s.notify.send(ctx, executionNotification(notificationExecution{ID: task.ID, Name: task.Name, Status: runStatus, Stdout: content},
		normalizeNotification(task.Notification), false))
}

type eventWriter interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

func persistentEvent(ctx context.Context, db eventWriter, id, kind, before, after, message string, exit *int, cause *string) error {
	_, err := db.Exec(ctx, `INSERT INTO pr_persistent_events (id,task_id,event_type,status_before,status_after,message,exit_code,error_summary)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, newID("event"), id, kind, before, after, message, exit, cause)
	return err
}
