package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"slices"
	"strings"
	"time"
)

const scheduleActor = "系统 · 定时任务"

func normalizeSchedule(workflowID string, body, existing record, at time.Time) (record, error) {
	now := timestamp(at)
	current := func(key string, fallback any) any {
		if value, ok := existing[key]; ok {
			return value
		}
		return fallback
	}
	getText := func(key, fallback string) string {
		return stringOr(body[key], stringOr(existing[key], fallback))
	}
	getOverride := func(key string, fallback any) any {
		if value, ok := body[key]; ok {
			return value
		}
		return current(key, fallback)
	}
	kind := getText("schedule_type", "once")
	if !slices.Contains([]string{"once", "daily", "weekly", "monthly", "cron"}, kind) {
		return nil, failure(422, "计划类型无效")
	}
	start := scheduleTimestamp(getText("start_at", now))
	if start.IsZero() {
		return nil, failure(422, "开始时间无效")
	}
	cron := stringValue(getOverride("cron_expression", ""))
	if kind == "cron" && len(strings.Fields(cron)) != 5 {
		return nil, failure(422, "Cron 表达式必须包含 5 个字段")
	}
	calendarField := func(key string) any {
		if value, present := body[key]; present {
			return int(numberOrZero(value))
		}
		return existing[key]
	}
	enabled := truthy(getOverride("enabled", true))
	item := record{
		"id": current("id", newID()), "workflow_id": workflowID, "name": getText("name", "未命名定时任务"),
		"schedule_type": kind, "timezone": getText("timezone", "Asia/Shanghai"), "start_at": timestamp(start),
		"end_at": nullableString(getText("end_at", "")), "weekday": calendarField("weekday"), "day_of_month": calendarField("day_of_month"),
		"cron_expression": cron, "cron_day_mode": getText("cron_day_mode", "calendar"),
		"title_template": getText("title_template", "{workflow} · {date}"), "note_template": getText("note_template", ""),
		"project_id": nullableString(getOverride("project_id", nil)), "milestone_id": nullableString(getOverride("milestone_id", nil)),
		"enabled": enabled, "next_run_at": nil, "last_run_at": existing["last_run_at"], "last_run_status": existing["last_run_status"],
		"last_run_error": existing["last_run_error"], "run_count": current("run_count", 0),
		"created_at": current("created_at", now), "updated_at": now,
	}
	if enabled {
		next := start
		// Keep an already planned occurrence during edits that leave the timing intact.
		previous := scheduleTimestamp(existing["next_run_at"])
		sameTiming := !previous.IsZero()
		for _, key := range []string{"schedule_type", "timezone", "start_at", "end_at", "weekday", "day_of_month", "cron_expression", "cron_day_mode"} {
			sameTiming = sameTiming && stringValue(item[key]) == stringValue(existing[key])
		}
		switch {
		case sameTiming:
			next = previous
		case kind != "once" && !start.After(at):
			// Calendar shifts preserve the selected wall time. Jump close to
			// the current date before scanning minute intervals at that time.
			cursor := start
			if kind == "cron" && at.Sub(cursor) > 48*time.Hour {
				zone := scheduleLocation(item["timezone"])
				wall := wallClock(at.In(zone)).Truncate(time.Hour).Add(-24 * time.Hour)
				cursor = resolveWallClock(wall.Add(time.Duration(start.In(zone).Second())*time.Second), zone)
			}
			next = nextScheduleTime(item, cursor)
			for !next.IsZero() && !next.After(at) {
				next = nextScheduleTime(item, next)
			}
		}
		if !next.IsZero() {
			item["next_run_at"] = timestamp(next)
		}
	}
	return item, nil
}

func (state *workflowState) runSchedule(schedule record, planned, at time.Time) record {
	now := timestamp(at)
	run := record{
		"id": newID(), "schedule_id": schedule["id"], "workflow_id": schedule["workflow_id"],
		"planned_at": timestamp(planned), "executed_at": now, "status": "failed", "ticket_id": nil, "error": nil,
	}
	workflow, err := state.workflow(stringValue(schedule["workflow_id"]))
	version := publishedVersion(workflow)
	switch {
	case err != nil:
		run["error"] = err.Error()
	case version == nil:
		run["status"], run["error"] = "skipped", "没有可用的已发布版本，未创建工单。"
	default:
		utc := planned.UTC()
		replacer := strings.NewReplacer(
			"{workflow}", stringValue(workflow["name"]), "{date}", utc.Format(time.DateOnly),
			"{year}", utc.Format("2006"), "{month}", utc.Format("01"), "{day}", utc.Format("02"),
			"{time}", utc.Format("15:04"), "{sequence}", fmt.Sprintf("%03d", len(state.entities["tickets"])+1),
		)
		input := record{
			"title": replacer.Replace(stringOr(schedule["title_template"], "{workflow} · {date}")),
			"note": stringOr(replacer.Replace(stringValue(schedule["note_template"])),
				fmt.Sprintf("由定时任务「%s」自动创建。", schedule["name"])),
			"owner_name": scheduleActor, "project_id": schedule["project_id"], "milestone_id": schedule["milestone_id"],
		}
		if ticket, err := state.createTicketFromVersion(workflow, version, input, scheduleActor, now); err != nil {
			run["error"] = err.Error()
		} else {
			run["status"], run["ticket_id"] = "succeeded", ticket["id"]
		}
	}
	schedule["last_run_at"], schedule["last_run_status"], schedule["last_run_error"] = now, run["status"], run["error"]
	schedule["run_count"], schedule["updated_at"] = scheduleInt(schedule["run_count"], 0)+1, now
	state.entities["schedule_runs"] = append([]record{run}, state.entities["schedule_runs"]...)
	return run
}

func runDueSchedules(ctx context.Context, repo stateRepository, at time.Time) error {
	const limit = 100
	return repo.update(ctx, func(state *workflowState) error {
		count := 0
		for _, schedule := range state.entities["schedules"] {
			for truthy(schedule["enabled"]) && count < limit {
				planned := scheduleTimestamp(schedule["next_run_at"])
				if planned.IsZero() || planned.After(at) {
					break
				}
				if err := ctx.Err(); err != nil {
					return err
				}
				state.runSchedule(schedule, planned, at)
				next := nextScheduleTime(schedule, planned)
				if next.IsZero() {
					schedule["enabled"], schedule["next_run_at"] = false, nil
				} else {
					schedule["next_run_at"] = timestamp(next)
				}
				count++
			}
		}
		return nil
	})
}

func scheduleWorker(ctx context.Context, repo stateRepository) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		if err := runDueSchedules(ctx, repo, time.Now()); err != nil && ctx.Err() == nil {
			log.Printf("workflow schedule worker error (%T)", err)
		}
		if err := runBackgroundReminders(ctx, repo, time.Now()); err != nil && ctx.Err() == nil {
			log.Printf("workflow reminder worker error (%T)", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func runBackgroundReminders(ctx context.Context, repo stateRepository, at time.Time) error {
	return repo.update(ctx, func(state *workflowState) error {
		state.runDueReminders(at)
		state.runDueProjectNotifications(at)
		state.cleanupTemporaryResources(at)
		return nil
	})
}

func (app *api) registerSchedules(mux *http.ServeMux) {
	const path = "/workflows/{workflowID}/schedules"
	app.endpoint(mux, "GET "+path, false, func(state *workflowState, request *http.Request, _ record) (any, error) {
		workflowID := request.PathValue("workflowID")
		if _, err := state.workflow(workflowID); err != nil {
			return nil, err
		}
		items := matchingRecords(state.entities["schedules"], "workflow_id", workflowID)
		slices.SortStableFunc(items, func(a, b record) int {
			enabledA, enabledB := truthy(a["enabled"]), truthy(b["enabled"])
			if enabledA != enabledB {
				if enabledA {
					return -1
				}
				return 1
			}
			return strings.Compare(stringValue(a["next_run_at"]), stringValue(b["next_run_at"]))
		})
		return items, nil
	})
	app.endpoint(mux, "POST "+path, true, func(state *workflowState, request *http.Request, body record) (any, error) {
		workflowID := request.PathValue("workflowID")
		if _, err := state.workflow(workflowID); err != nil {
			return nil, err
		}
		item, err := normalizeSchedule(workflowID, body, nil, time.Now())
		if err == nil {
			state.entities["schedules"] = append([]record{item}, state.entities["schedules"]...)
		}
		return item, err
	})
	for _, route := range []struct {
		pattern string
		write   bool
		handle  func(*workflowState, record, *http.Request, record) (any, error)
	}{
		{"PUT ", true, func(state *workflowState, previous record, _ *http.Request, body record) (any, error) {
			next, err := normalizeSchedule(stringValue(previous["workflow_id"]), body, previous, time.Now())
			if err != nil {
				return nil, err
			}
			for i, item := range state.entities["schedules"] {
				if item["id"] == previous["id"] {
					state.entities["schedules"][i] = next
					break
				}
			}
			return next, nil
		}},
		{"DELETE ", true, func(state *workflowState, item record, _ *http.Request, _ record) (any, error) {
			state.entities["schedules"] = removeMatching(state.entities["schedules"], "id", item["id"])
			state.entities["schedule_runs"] = removeMatching(state.entities["schedule_runs"], "schedule_id", item["id"])
			return nil, nil
		}},
		{"GET /runs", false, func(state *workflowState, item record, request *http.Request, _ record) (any, error) {
			runs := matchingRecords(state.entities["schedule_runs"], "schedule_id", item["id"])
			limit := positiveQuery(request.URL.Query().Get("limit"), 30)
			return runs[:min(len(runs), limit)], nil
		}},
		{"POST /run", true, func(state *workflowState, schedule record, _ *http.Request, _ record) (any, error) {
			now := time.Now()
			return record{"schedule": schedule, "run": state.runSchedule(schedule, now, now)}, nil
		}},
	} {
		method, suffix, _ := strings.Cut(route.pattern, " ")
		app.endpoint(mux, method+" "+path+"/{scheduleID}"+suffix, route.write, func(state *workflowState, request *http.Request, body record) (any, error) {
			item := findRecord(state.entities["schedules"], request.PathValue("scheduleID"))
			if item == nil || item["workflow_id"] != request.PathValue("workflowID") {
				return nil, failure(404, "定时任务不存在")
			}
			return route.handle(state, item, request, body)
		})
	}
}

func matchingRecords(values []record, key string, value any) []record {
	result := []record{}
	for _, item := range values {
		if item[key] == value {
			result = append(result, item)
		}
	}
	return result
}

func removeMatching(values []record, key string, value any) []record {
	return slices.DeleteFunc(values, func(item record) bool { return item[key] == value })
}
