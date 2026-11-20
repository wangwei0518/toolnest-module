package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type executionSource struct {
	Type      string `json:"type"`
	Code      string `json:"code,omitempty"`
	ProjectID string `json:"project_id,omitempty"`
	UploadID  string `json:"upload_id,omitempty"`
	EntryFile string `json:"entry_file,omitempty"`
}

type executionInput struct {
	Name                  string               `json:"name"`
	Source                executionSource      `json:"source"`
	Args                  []string             `json:"args"`
	TimeoutSeconds        *float64             `json:"timeout_seconds"`
	Runtime               string               `json:"runtime_environment"`
	WorkingDirectory      *string              `json:"working_directory"`
	Security              securityConfirmation `json:"security"`
	TaskMode, TriggerType string               `json:"-"`
	TriggerID             *string              `json:"-"`
	Notification          any                  `json:"-"`
	Recovered             bool                 `json:"-"`
}

type preparedExecution struct {
	projectID, sourcePath    *string
	entry, code, interpreter string
}

type prepareArchiveExecution func(context.Context, executionInput, string) (preparedExecution, error)

var errExecutionCapacity = badRequest("当前执行任务已达到并发上限，请稍后重试。")

type executions struct {
	config         config
	db             *pgxpool.Pool
	notify         notifier
	prepareArchive prepareArchiveExecution

	mu      sync.Mutex
	running map[string]context.CancelFunc
	closing bool
	wait    sync.WaitGroup
}

func (e *executions) reserve(id string, cancel context.CancelFunc) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.closing {
		return &requestError{status: 503, message: "模块正在关闭。"}
	}
	if len(e.running) >= e.config.concurrentExecutions {
		return errExecutionCapacity
	}
	e.running[id] = cancel
	e.wait.Add(1)
	return nil
}

func (e *executions) close() {
	e.mu.Lock()
	e.closing = true
	for _, cancel := range e.running {
		cancel()
	}
	e.mu.Unlock()
	e.wait.Wait()
}

func validateArgs(args []string) error {
	if len(args) > 64 {
		return badRequest("命令行参数不能超过 64 个。")
	}
	total := 0
	for _, arg := range args {
		total += len(arg)
		if len(arg) > 1024 || strings.IndexFunc(arg, func(r rune) bool { return r < 32 || r == 127 }) >= 0 || total > 8192 {
			return badRequest("命令行参数包含不允许的字符或长度超限。")
		}
	}
	return nil
}

func (e *executions) create(ctx context.Context, input executionInput) (json.RawMessage, error) {
	if err := validateArgs(input.Args); err != nil {
		return nil, err
	}
	if input.Args == nil {
		input.Args = []string{}
	}
	timeout := min(30, e.config.executionSeconds)
	if input.TimeoutSeconds != nil {
		timeout = int(min(float64(e.config.executionSeconds), max(1, *input.TimeoutSeconds)))
	}
	id := newID("exec")
	processContext, stop := context.WithCancel(context.WithoutCancel(ctx))
	defer stop()
	if err := e.reserve(id, stop); err != nil {
		return nil, err
	}
	defer func() {
		e.mu.Lock()
		delete(e.running, id)
		e.mu.Unlock()
		e.wait.Done()
	}()
	workspace := filepath.Join(e.config.dataDir, "workspaces", id)
	if err := os.MkdirAll(workspace, 0700); err != nil {
		return nil, err
	}
	defer os.RemoveAll(workspace)
	prepared, err := e.prepare(processContext, input, workspace)
	if err != nil {
		return nil, err
	}
	directory := workspace
	var working *string
	if input.Source.Type == "archive" && input.WorkingDirectory != nil && strings.TrimSpace(*input.WorkingDirectory) != "" {
		path, err := projectRelative(*input.WorkingDirectory)
		if err != nil {
			return nil, err
		}
		working = &path
		directory = filepath.Join(workspace, filepath.FromSlash(path))
	}
	if info, err := os.Stat(directory); err != nil || !info.IsDir() {
		return nil, badRequest("工作目录不存在或不是目录。")
	}

	logs := filepath.Join(e.config.logDir, "executions")
	if err := os.MkdirAll(logs, 0700); err != nil {
		return nil, err
	}
	stdoutPath := filepath.Join(logs, id+".stdout")
	stderrPath := filepath.Join(logs, id+".stderr")
	start := time.Now().UTC()
	source := map[string]any{"type": input.Source.Type}
	if prepared.projectID != nil {
		source["project_id"], source["upload_id"], source["entry_file"] = *prepared.projectID, *prepared.projectID, prepared.entry
	}
	policy := normalizeNotification(input.Notification)
	if input.Notification != nil {
		source["notification_config"] = policy
	}
	name := []rune(strings.TrimSpace(input.Name))
	if len(name) == 0 {
		name = []rune("未命名脚本")
	}
	displayName := string(name[:min(len(name), 120)])
	mode, trigger := input.TaskMode, input.TriggerType
	if mode == "" {
		mode = "once"
	}
	if trigger == "" {
		trigger = "manual"
	}
	if _, err := e.db.Exec(processContext, insertExecution,
		id, displayName, prepared.projectID, mode, trigger, input.TriggerID, input.Source.Type, source,
		prepared.sourcePath, prepared.code, prepared.entry, working, input.Args, timeout, stdoutPath, stderrPath, workspace, start,
	); err != nil {
		return nil, err
	}

	stdout := outputBuffer{limit: e.config.outputBytes}
	stderr := outputBuffer{limit: e.config.outputBytes}
	runContext, cancel := context.WithTimeout(processContext, time.Duration(timeout)*time.Second)
	defer cancel()
	cmd := pythonCommand(runContext, prepared.interpreter, directory,
		slices.Concat([]string{filepath.Join(workspace, filepath.FromSlash(prepared.entry))}, input.Args),
		pythonEnvironment("TOOLNEST_EXECUTION_ID="+id, "TOOLNEST_EXECUTION_WORKSPACE="+workspace))
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	runErr := cmd.Run()
	status := "success"
	var exitCode *int
	if cmd.ProcessState != nil {
		value := cmd.ProcessState.ExitCode()
		if value >= 0 {
			exitCode = &value
		}
	} else {
		value := -1
		exitCode = &value
	}
	switch {
	case processContext.Err() != nil:
		status = "stopped"
	case errors.Is(runContext.Err(), context.DeadlineExceeded):
		status = "timeout"
	case runErr != nil:
		status = "failed"
	}
	stdout.finish()
	stderr.finish()
	out, truncatedOut := stdout.snapshot()
	errOut, truncatedErr := stderr.snapshot()
	// PostgreSQL text cannot store embedded NUL bytes.
	out = strings.ReplaceAll(out, "\x00", "�")
	errOut = strings.ReplaceAll(errOut, "\x00", "�")
	finished := time.Now().UTC()
	duration := finished.Sub(start).Milliseconds()
	finalize, finish := context.WithTimeout(context.WithoutCancel(ctx), 8*time.Second)
	defer finish()
	_, updateErr := e.db.Exec(finalize, finishExecution, status, out, errOut, exitCode, truncatedOut || truncatedErr, finished, duration, id)
	if updateErr != nil {
		return nil, updateErr
	}
	logErr := errors.Join(os.WriteFile(stdoutPath, []byte(out), 0600), os.WriteFile(stderrPath, []byte(errOut), 0600))
	if logErr != nil {
		return nil, fmt.Errorf("write execution log: %w", logErr)
	}
	if input.Notification != nil {
		e.notify.send(finalize, executionNotification(notificationExecution{
			ID: id, Name: displayName, Status: status, Stdout: out, Stderr: errOut, DurationMS: duration,
		}, policy, input.Recovered))
	}
	return e.get(finalize, id)
}

func (e *executions) prepare(ctx context.Context, input executionInput, workspace string) (preparedExecution, error) {
	switch input.Source.Type {
	case "inline":
		code := input.Source.Code
		if strings.TrimSpace(code) == "" {
			return preparedExecution{}, badRequest("Python 代码不能为空。")
		}
		if err := scanInline(code).require(input.Security, "运行代码"); err != nil {
			return preparedExecution{}, err
		}
		err := os.WriteFile(filepath.Join(workspace, "main.py"), []byte(code), 0600)
		return preparedExecution{entry: "main.py", code: code, interpreter: e.config.python}, err
	case "archive":
		if e.prepareArchive != nil {
			return e.prepareArchive(ctx, input, workspace)
		}
	}
	return preparedExecution{}, badRequest("无效的 Python 执行来源。")
}

const insertExecution = `INSERT INTO pr_executions
	(id, name, project_id, task_mode, trigger_type, trigger_id, source_type, source_config, source_snapshot_path,
	code_snapshot, entry_file, working_directory, args, timeout_seconds, status, stdout_path, stderr_path, workspace_path, started_at, updated_at)
	VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'running',$15,$16,$17,$18,$18)`
const finishExecution = `UPDATE pr_executions
	SET status=$1, stdout=$2, stderr=$3, exit_code=$4, logs_truncated=$5, finished_at=$6, duration_ms=$7, updated_at=$6 WHERE id=$8`

func (e *executions) get(ctx context.Context, id string) (json.RawMessage, error) {
	var result json.RawMessage
	err := e.db.QueryRow(ctx, "SELECT to_jsonb(e)-'project_id' FROM pr_executions e WHERE id=$1", id).Scan(&result)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, notFound("执行记录不存在。")
	}
	return result, err
}

func (e *executions) list(ctx context.Context) ([]json.RawMessage, error) {
	rows, err := e.db.Query(ctx, "SELECT to_jsonb(e)-'project_id' FROM pr_executions e ORDER BY created_at DESC LIMIT 100")
	if err != nil {
		return nil, err
	}
	return pgx.AppendRows([]json.RawMessage{}, rows, pgx.RowTo[json.RawMessage])
}

func (e *executions) stop(ctx context.Context, id string) (json.RawMessage, error) {
	e.mu.Lock()
	cancel := e.running[id]
	e.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	return e.get(ctx, id)
}

func (e *executions) remove(ctx context.Context, id string) error {
	e.mu.Lock()
	active := e.running[id] != nil
	e.mu.Unlock()
	if active {
		return badRequest("运行中的执行记录不能删除，请先停止任务。")
	}
	tag, err := e.db.Exec(ctx, "DELETE FROM pr_executions WHERE id=$1", id)
	if err == nil && tag.RowsAffected() == 0 {
		return notFound("执行记录不存在。")
	}
	return err
}
