package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"strings"
	"sync"
	"time"
	_ "time/tzdata"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type scheduleInput struct {
	Name         string               `json:"name"`
	Description  string               `json:"description"`
	Source       executionSource      `json:"source"`
	Args         []string             `json:"args"`
	Timeout      int                  `json:"timeout_seconds"`
	Type         string               `json:"schedule_type"`
	Expression   *string              `json:"cron_expression"`
	RunAt        *string              `json:"run_at"`
	Timezone     string               `json:"timezone"`
	Enabled      *bool                `json:"enabled"`
	Notification map[string]any       `json:"notification_config"`
	Security     securityConfirmation `json:"security"`
}

type taskSource struct {
	executionSource
	Security securityConfirmation `json:"security"`
}

type schedule struct {
	ID           string         `json:"id"`
	Name         string         `json:"name"`
	Source       taskSource     `json:"source"`
	Args         []string       `json:"args"`
	Timeout      float64        `json:"timeout_seconds"`
	Type         string         `json:"schedule_type"`
	Expression   *string        `json:"cron_expression"`
	RunAt        *time.Time     `json:"run_at"`
	Timezone     string         `json:"timezone"`
	Enabled      bool           `json:"enabled"`
	Next         *time.Time     `json:"next_run_at"`
	LastStatus   *string        `json:"last_status"`
	Notification map[string]any `json:"notification_config"`
}

type scheduleService struct {
	db         *pgxpool.Pool
	executions *executions
	projects   *projectService
}

const scheduleJSON = `to_jsonb(s) || jsonb_build_object(
	'code',CASE WHEN source->>'type'='inline' THEN COALESCE(source->>'code','') ELSE '' END,
	'source_type',source->>'type','source_config',source)`

func (s *scheduleService) get(ctx context.Context, id string) (json.RawMessage, error) {
	var data json.RawMessage
	err := s.db.QueryRow(ctx, "SELECT "+scheduleJSON+" FROM pr_scheduled_tasks s WHERE id=$1", id).Scan(&data)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, notFound("定时任务不存在。")
	}
	return data, err
}

func (s *scheduleService) list(ctx context.Context, keyword, status string, page, size int) (map[string]any, error) {
	const where = ` WHERE ($1='' OR name ILIKE '%'||$1||'%') AND ($2='' OR status=$2)`
	var total int64
	if err := s.db.QueryRow(ctx, "SELECT COUNT(*) FROM pr_scheduled_tasks"+where, keyword, status).Scan(&total); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx, "SELECT "+scheduleJSON+" FROM pr_scheduled_tasks s"+where+" ORDER BY created_at DESC LIMIT $3 OFFSET $4",
		keyword, status, size, int64(page-1)*int64(size))
	if err != nil {
		return nil, err
	}
	items, err := pgx.AppendRows([]json.RawMessage{}, rows, pgx.RowTo[json.RawMessage])
	return map[string]any{"items": items, "total": total, "page": page, "page_size": size}, err
}

func scheduleTime(value *string) (*time.Time, error) {
	if value == nil || *value == "" {
		return nil, nil
	}
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02T15:04", "2006-01-02T15:04:05", "2006-01-02"} {
		if parsed, err := time.Parse(layout, *value); err == nil {
			return &parsed, nil
		}
	}
	return nil, badRequest("一次性任务时间无效。")
}

func scheduleNext(kind string, expression *string, runAt *time.Time, zone string, now time.Time) (*time.Time, error) {
	if zone == "" {
		zone = "UTC"
	}
	if zone == "Local" {
		return nil, badRequest("任务时区无效。")
	}
	location, err := time.LoadLocation(zone)
	if err != nil {
		return nil, badRequest("任务时区无效。")
	}
	switch kind {
	case "once":
		if runAt == nil {
			return nil, badRequest("一次性任务必须填写执行时间。")
		}
		if runAt.After(now) {
			return runAt, nil
		}
		return nil, nil
	case "cron":
		if expression == nil || strings.TrimSpace(*expression) == "" {
			return nil, badRequest("Cron 任务必须填写 Cron 表达式。")
		}
		next, err := nextCron(*expression, now, location)
		if err != nil {
			return nil, err
		}
		return &next, nil
	default:
		return nil, badRequest("定时任务类型无效。")
	}
}

func (s *projectService) confirmSource(ctx context.Context, source executionSource, confirmation securityConfirmation, action string) error {
	switch source.Type {
	case "inline":
		if strings.TrimSpace(source.Code) == "" {
			return badRequest("Python 代码不能为空。")
		}
		return scanInline(source.Code).require(confirmation, action)
	case "archive":
		id := source.ProjectID
		if id == "" {
			id = source.UploadID
		}
		if id == "" {
			return badRequest("项目执行必须提供 project_id。")
		}
		p, err := s.get(ctx, id)
		if err != nil {
			return err
		}
		scan, err := s.projectScan(ctx, p, false)
		if err != nil {
			return err
		}
		return scan.require(confirmation, action)
	default:
		return badRequest("定时任务必须填写有效执行来源。")
	}
}

func (s *scheduleService) save(ctx context.Context, id string, input scheduleInput) (json.RawMessage, error) {
	name := []rune(strings.TrimSpace(input.Name))
	if len(name) == 0 {
		return nil, badRequest("定时任务名称不能为空。")
	}
	description := []rune(strings.TrimSpace(input.Description))
	if input.Args == nil {
		input.Args = []string{}
	}
	if err := validateArgs(input.Args); err != nil {
		return nil, err
	}
	if input.Notification == nil {
		input.Notification = map[string]any{}
	}
	if input.Timeout == 0 {
		input.Timeout = 30
	}
	if input.Timezone = strings.TrimSpace(input.Timezone); input.Timezone == "" {
		input.Timezone = "UTC"
	}
	runAt, err := scheduleTime(input.RunAt)
	if err != nil {
		return nil, err
	}
	next, err := scheduleNext(input.Type, input.Expression, runAt, input.Timezone, time.Now())
	if err != nil {
		return nil, err
	}
	enabled := input.Enabled == nil || *input.Enabled
	status := "enabled"
	if !enabled {
		next, status = nil, "disabled"
	}
	action := "创建定时任务"
	if id != "" {
		action = "更新定时任务"
	}
	if err := s.projects.confirmSource(ctx, input.Source, input.Security, action); err != nil {
		return nil, err
	}
	args := []any{string(name[:min(len(name), 120)]), string(description[:min(len(description), 500)]),
		taskSource{input.Source, input.Security}, input.Args, min(600, max(1, input.Timeout)), input.Type,
		input.Expression, runAt, input.Timezone, enabled, status, next, input.Notification}
	if id == "" {
		id = newID("schedule")
		_, err = s.db.Exec(ctx, `INSERT INTO pr_scheduled_tasks
			(name,description,source,args,timeout_seconds,schedule_type,cron_expression,run_at,timezone,
			enabled,status,next_run_at,notification_config,id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
			append(args, id)...)
	} else {
		_, err = s.db.Exec(ctx, `UPDATE pr_scheduled_tasks SET name=$1,description=$2,source=$3,args=$4,timeout_seconds=$5,
			schedule_type=$6,cron_expression=$7,run_at=$8,timezone=$9,enabled=$10,
			status=CASE WHEN status='running' THEN status ELSE $11 END,next_run_at=$12,notification_config=$13,updated_at=NOW()
			WHERE id=$14`, append(args, id)...)
	}
	if err != nil {
		return nil, err
	}
	return s.get(ctx, id)
}

func (s *scheduleService) toggle(ctx context.Context, id string, enable bool) (json.RawMessage, error) {
	var next *time.Time
	if enable {
		raw, err := s.get(ctx, id)
		if err != nil {
			return nil, err
		}
		var task schedule
		if err := json.Unmarshal(raw, &task); err != nil {
			return nil, err
		}
		next, err = scheduleNext(task.Type, task.Expression, task.RunAt, task.Timezone, time.Now())
		if err != nil {
			return nil, err
		}
	}
	_, err := s.db.Exec(ctx, `UPDATE pr_scheduled_tasks SET enabled=$1,next_run_at=$2,updated_at=NOW(),
		status=CASE WHEN status='running' THEN status WHEN $1 THEN 'enabled' ELSE 'disabled' END WHERE id=$3`, enable, next, id)
	if err != nil {
		return nil, err
	}
	return s.get(ctx, id)
}

func (s *scheduleService) remove(ctx context.Context, id string) error {
	tag, err := s.db.Exec(ctx, "DELETE FROM pr_scheduled_tasks WHERE id=$1", id)
	if err == nil && tag.RowsAffected() == 0 {
		return notFound("定时任务不存在。")
	}
	return err
}

func (s *scheduleService) dispatch(ctx context.Context, task schedule, automatic bool) error {
	now := time.Now().UTC()
	var next *time.Time
	if automatic {
		var err error
		next, err = scheduleNext(task.Type, task.Expression, task.RunAt, task.Timezone, now)
		if err != nil {
			return err
		}
	}
	tag, err := s.db.Exec(ctx, `UPDATE pr_scheduled_tasks SET status='running',
		next_run_at=CASE WHEN $2 THEN $3 ELSE next_run_at END,updated_at=NOW()
		WHERE id=$1 AND status<>'running'
		AND (NOT $2 OR (enabled AND next_run_at=$4 AND next_run_at<=NOW()))`, task.ID, automatic, next, task.Next)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		if automatic {
			return nil
		}
		return &requestError{status: 409, message: "定时任务正在运行或已变更。"}
	}
	if task.Notification == nil {
		task.Notification = map[string]any{}
	}
	var executionID *string
	status := "failed"
	result, runErr := s.executions.create(ctx, executionInput{
		Name: task.Name, Source: task.Source.executionSource, Args: task.Args, TimeoutSeconds: &task.Timeout, Runtime: "auto",
		Security: task.Source.Security, TaskMode: "schedule", TriggerType: "schedule", TriggerID: &task.ID,
		Notification: task.Notification, Recovered: task.LastStatus != nil && *task.LastStatus == "failed",
	})
	var row struct{ ID, Status string }
	if runErr == nil {
		runErr = json.Unmarshal(result, &row)
		if runErr == nil {
			executionID, status = &row.ID, row.Status
		}
	}
	persist, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if automatic && errors.Is(runErr, errExecutionCapacity) {
		_, err = s.db.Exec(persist, `UPDATE pr_scheduled_tasks SET status=CASE WHEN enabled THEN 'enabled' ELSE 'disabled' END,
			next_run_at=CASE WHEN enabled AND next_run_at IS NOT DISTINCT FROM $2 THEN $3 ELSE next_run_at END WHERE id=$1`, task.ID, next, task.Next)
		return err
	}
	_, err = s.db.Exec(persist, `UPDATE pr_scheduled_tasks SET status=CASE WHEN enabled THEN 'enabled' ELSE 'disabled' END,
		last_execution_id=COALESCE($1,last_execution_id),last_run_at=$2,last_status=$3,total_runs=total_runs+1,
		success_runs=success_runs+CASE WHEN $3='success' THEN 1 ELSE 0 END,
		failed_runs=failed_runs+CASE WHEN $3='success' THEN 0 ELSE 1 END,updated_at=NOW() WHERE id=$4`, executionID, now, status, task.ID)
	return errors.Join(runErr, err)
}

func (s *scheduleService) run(ctx context.Context, id string) (json.RawMessage, error) {
	raw, err := s.get(ctx, id)
	if err != nil {
		return nil, err
	}
	var task schedule
	if err := json.Unmarshal(raw, &task); err != nil {
		return nil, err
	}
	if err := s.dispatch(ctx, task, false); err != nil {
		return nil, err
	}
	return s.get(context.WithoutCancel(ctx), id)
}

func (s *scheduleService) start(ctx context.Context, period time.Duration) func() {
	ctx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	var running sync.WaitGroup
	capacity := make(chan struct{}, s.executions.config.concurrentExecutions)
	go func() {
		defer close(done)
		defer running.Wait()
		ticker := time.NewTicker(period)
		defer ticker.Stop()
		for ctx.Err() == nil {
			if err := s.tick(ctx, capacity, &running); err != nil && ctx.Err() == nil {
				log.Printf("Python Runner schedule tick: %v", err)
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
	return func() { cancel(); <-done }
}

func (s *scheduleService) tick(ctx context.Context, capacity chan struct{}, running *sync.WaitGroup) error {
	rows, err := s.db.Query(ctx, `SELECT to_jsonb(s) FROM pr_scheduled_tasks s
		WHERE enabled AND status<>'running' AND next_run_at<=NOW() ORDER BY next_run_at LIMIT 20`)
	if err != nil {
		return err
	}
	due, err := pgx.CollectRows(rows, pgx.RowTo[json.RawMessage])
	if err != nil {
		return err
	}
	for _, data := range due {
		var task schedule
		if err := json.Unmarshal(data, &task); err != nil {
			log.Printf("invalid Python Runner schedule: %v", err)
			continue
		}
		if len(capacity) == cap(capacity) {
			break
		}
		capacity <- struct{}{}
		running.Go(func() {
			defer func() { <-capacity }()
			if err := s.dispatch(ctx, task, true); err != nil && ctx.Err() == nil {
				log.Printf("scheduled Python task %s: %v", task.ID, err)
			}
		})
	}
	return nil
}

func (s *scheduleService) upcoming(ctx context.Context, limit int) ([]json.RawMessage, error) {
	rows, err := s.db.Query(ctx, "SELECT "+scheduleJSON+" FROM pr_scheduled_tasks s WHERE enabled AND next_run_at IS NOT NULL ORDER BY next_run_at LIMIT $1", limit)
	if err != nil {
		return nil, err
	}
	return pgx.AppendRows([]json.RawMessage{}, rows, pgx.RowTo[json.RawMessage])
}
