package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type overviewExecution struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Status      string  `json:"status"`
	Stdout      string  `json:"stdout"`
	Stderr      string  `json:"stderr"`
	TaskMode    string  `json:"task_mode"`
	TriggerType string  `json:"trigger_type"`
	TriggerID   *string `json:"trigger_id"`
	StartedAt   *string `json:"started_at"`
	CreatedAt   string  `json:"created_at"`
	UpdatedAt   string  `json:"updated_at"`
	ExitCode    *int    `json:"exit_code"`
	DurationMS  *int    `json:"duration_ms"`
}

func registerOverviewRoutes(routes *http.ServeMux, db *pgxpool.Pool, e *executions, s *scheduleService) {
	routes.Handle("GET /overview", endpoint(func(_ http.ResponseWriter, r *http.Request) (any, error) {
		return overview(r.Context(), db, e, s)
	}))
	routes.Handle("GET /timeline", endpoint(func(_ http.ResponseWriter, r *http.Request) (any, error) {
		return timeline(r.Context(), e, s, boundedQueryInt(r, "limit", 30, 50))
	}))
}

func overview(ctx context.Context, db *pgxpool.Pool, e *executions, s *scheduleService) (any, error) {
	var running, total, success, failed, finished, scheduleCount, persistentRunning, persistentFailed int
	var next *time.Time
	err := db.QueryRow(ctx, `SELECT
		COUNT(*) FILTER (WHERE status='running'),
		COUNT(*) FILTER (WHERE created_at>=CURRENT_DATE),
		COUNT(*) FILTER (WHERE created_at>=CURRENT_DATE AND status='success'),
		COUNT(*) FILTER (WHERE created_at>=CURRENT_DATE AND status IN ('failed','timeout')),
		COUNT(*) FILTER (WHERE created_at>=CURRENT_DATE AND status IN ('success','failed','timeout','stopped','skipped')),
		(SELECT COUNT(*) FROM pr_scheduled_tasks WHERE enabled),(SELECT MIN(next_run_at) FROM pr_scheduled_tasks),
		(SELECT COUNT(*) FROM pr_persistent_tasks WHERE status='running'),
		(SELECT COUNT(*) FROM pr_persistent_tasks WHERE status='failed')
		FROM pr_executions`).Scan(&running, &total, &success, &failed, &finished, &scheduleCount, &next, &persistentRunning, &persistentFailed)
	if err != nil {
		return nil, err
	}
	recent, err := e.list(ctx)
	if err != nil {
		return nil, err
	}
	active := []json.RawMessage{}
	logs, errLogs := []map[string]any{}, []map[string]any{}
	for _, raw := range recent {
		var row overviewExecution
		if err := json.Unmarshal(raw, &row); err != nil {
			return nil, err
		}
		if row.Status == "running" && len(active) < 5 {
			active = append(active, raw)
		}
		if len(logs) < 20 {
			logs = appendOverviewOutput(logs, row, "stdout", row.Stdout)
			logs = appendOverviewOutput(logs, row, "stderr", row.Stderr)
		}
		if len(errLogs) < 20 && (row.Status == "failed" || row.Status == "timeout") {
			content := row.Stderr
			if strings.TrimSpace(content) == "" {
				content = errorSummary(row)
			}
			errLogs = appendOverviewOutput(errLogs, row, "stderr", content)
		}
	}
	upcoming, err := s.upcoming(ctx, 5)
	if err != nil {
		return nil, err
	}
	schedulePreview := []map[string]any{}
	for _, raw := range upcoming {
		var item map[string]any
		if err := json.Unmarshal(raw, &item); err != nil {
			return nil, err
		}
		out := map[string]any{}
		for _, key := range []string{"id", "name", "description", "schedule_type", "cron_expression", "next_run_at", "status"} {
			out[key] = item[key]
		}
		schedulePreview = append(schedulePreview, out)
	}
	rate := 0.0
	if finished > 0 {
		rate = math.Round(float64(success)*1000/float64(finished)) / 10
	}
	return map[string]any{
		"stats": map[string]any{"running_count": running, "today_total": total, "today_success": success, "today_failed": failed,
			"success_rate": rate, "enabled_schedule_count": scheduleCount, "next_schedule_time": optionalTime(next),
			"running_persistent_count": persistentRunning, "failed_persistent_count": persistentFailed},
		"recent_executions": recent[:min(10, len(recent))], "running_executions": active, "upcoming_schedules": schedulePreview,
		"recent_logs": logs[:min(20, len(logs))], "error_logs": errLogs,
	}, nil
}

func appendOverviewOutput(items []map[string]any, row overviewExecution, stream, content string) []map[string]any {
	if strings.TrimSpace(content) == "" {
		return items
	}
	return append(items, map[string]any{"execution_id": row.ID, "execution_name": row.Name, "type": stream,
		"content": notificationTail(content, 100, 20000), "timestamp": row.UpdatedAt, "status": row.Status, "exit_code": row.ExitCode})
}

func errorSummary(row overviewExecution) string {
	if row.Status != "failed" && row.Status != "timeout" {
		return ""
	}
	for _, line := range strings.Split(row.Stderr, "\n") {
		if line = strings.TrimSpace(line); line != "" {
			chars := []rune(line)
			return string(chars[:min(240, len(chars))])
		}
	}
	if row.ExitCode != nil {
		return fmt.Sprintf("退出码 %d", *row.ExitCode)
	}
	if row.Status == "timeout" {
		return "执行超时。"
	}
	return "执行失败。"
}

func timeline(ctx context.Context, e *executions, s *scheduleService, limit int) (any, error) {
	recent, err := e.list(ctx)
	if err != nil {
		return nil, err
	}
	upcoming, err := s.upcoming(ctx, 5)
	if err != nil {
		return nil, err
	}
	items := []map[string]any{}
	for _, raw := range upcoming {
		var task map[string]any
		if err := json.Unmarshal(raw, &task); err != nil {
			return nil, err
		}
		scheduleText := task["cron_expression"]
		if task["schedule_type"] == "once" {
			scheduleText = "一次性任务"
		}
		description, _ := task["description"].(string)
		if description == "" {
			description = "计划任务"
		}
		items = append(items, map[string]any{"id": fmt.Sprint("schedule_", task["id"]), "kind": "schedule_upcoming",
			"status": "upcoming", "title": task["name"], "subtitle": description, "event_time": task["next_run_at"],
			"trigger_type": "schedule", "schedule_text": scheduleText, "schedule_id": task["id"]})
	}
	active, finished := []map[string]any{}, []map[string]any{}
	for _, raw := range recent {
		var row overviewExecution
		if err := json.Unmarshal(raw, &row); err != nil {
			return nil, err
		}
		if row.Status == "running" {
			if len(active) < 5 {
				active = append(active, timelineExecution(row))
			}
		} else if len(finished) < 10 {
			finished = append(finished, timelineExecution(row))
		}
	}
	items = append(append(items, active...), finished...)
	return map[string]any{"items": items[:min(limit, len(items))]}, nil
}

func timelineExecution(row overviewExecution) map[string]any {
	status := row.Status
	switch status {
	case "success":
		status = "finished"
	case "failed", "timeout":
		status = "failed"
	case "running", "stopped", "skipped":
	default:
		status = "stopped"
	}
	kind := "execution_" + status
	if row.Status == "success" {
		kind = "execution_success"
	}
	at := row.CreatedAt
	if row.StartedAt != nil {
		at = *row.StartedAt
	}
	var scheduleID *string
	if row.TaskMode == "schedule" || row.TaskMode == "scheduled" {
		scheduleID = row.TriggerID
	}
	return map[string]any{"id": "execution_" + row.ID, "kind": kind, "status": status, "title": row.Name, "subtitle": row.TriggerType,
		"event_time": at, "trigger_type": row.TriggerType, "execution_id": row.ID, "duration_ms": row.DurationMS,
		"exit_code": row.ExitCode, "schedule_id": scheduleID, "error_summary": nullString(errorSummary(row))}
}
