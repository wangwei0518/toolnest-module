package main

import (
	"fmt"
	"maps"
	"math"
	"slices"
	"strings"
	"time"
)

func defaultValue(value, fallback any) any {
	if value == nil {
		return fallback
	}
	return value
}

func firstProvided(body record, keys ...string) (any, bool) {
	for _, key := range keys {
		if value, ok := body[key]; ok {
			return value, true
		}
	}
	return nil, false
}

func sortedUpdated(items []record) []record {
	result := append([]record{}, items...)
	slices.SortStableFunc(result, func(a, b record) int {
		return strings.Compare(stringValue(b["updated_at"]), stringValue(a["updated_at"]))
	})
	return result
}

func stateCounts(items []record, field string) map[string]int {
	counts := make(map[string]int)
	for _, item := range items {
		counts[stringValue(item[field])]++
	}
	return counts
}

func percent(count, total int) int {
	if total == 0 {
		return 0
	}
	return int(math.Round(float64(count) * 100 / float64(total)))
}

func overdue(at any, now time.Time) bool {
	date := scheduleTimestamp(at)
	return !date.IsZero() && date.Before(now)
}

func activeMilestone(status any) bool {
	return status != "completed" && status != "cancelled"
}

func (state *workflowState) projectRead(project record, now time.Time) record {
	result := maps.Clone(project)
	tickets := matchingRecords(state.entities["tickets"], "project_id", project["id"])
	milestones := matchingRecords(state.entities["milestones"], "project_id", project["id"])
	completed, blocked := 0, false
	for _, ticket := range tickets {
		switch ticket["status"] {
		case "completed":
			completed++
		case "blocked":
			blocked = true
		}
	}
	current := record{}
	health := "normal"
	if blocked {
		health = "risk"
	}
	for _, milestone := range milestones {
		if !activeMilestone(milestone["status"]) {
			continue
		}
		if overdue(milestone["target_at"], now) {
			health = "overdue"
		}
		if len(current) == 0 || earlierMilestone(milestone, current) {
			current = milestone
		}
	}
	result["goal"] = defaultValue(project["goal"], project["description"])
	result["planned_start_at"] = defaultValue(project["planned_start_at"], project["start_at"])
	result["review_markdown"] = defaultValue(project["review_markdown"], project["note"])
	result["default_workflow_id"] = project["default_workflow_id"]
	result["color"] = defaultValue(project["color"], "primary")
	result["icon"] = defaultValue(project["icon"], "flag")
	result["favorite"] = defaultValue(project["favorite"], false)
	result["ticket_count"], result["completed_ticket_count"], result["milestone_count"] = len(tickets), completed, len(milestones)
	result["progress"], result["health"] = percent(completed, len(tickets)), health
	result["current_milestone_id"], result["current_milestone_name"] = current["id"], current["name"]
	result["current_milestone_goal"], result["current_milestone_target_at"] = defaultValue(current["goal"], current["description"]), current["target_at"]
	return result
}

func earlierMilestone(a, b record) bool {
	activeA, activeB := a["status"] == "in_progress", b["status"] == "in_progress"
	if activeA != activeB {
		return activeA
	}
	dateA, dateB := stringOr(a["target_at"], "9999"), stringOr(b["target_at"], "9999")
	if dateA != dateB {
		return dateA < dateB
	}
	return stringValue(a["updated_at"]) > stringValue(b["updated_at"])
}

func (state *workflowState) createProject(body record, actor string, at time.Time) (record, error) {
	name := stringValue(body["name"])
	if name == "" {
		return nil, failure(422, "项目名称不能为空")
	}
	prefix := "PRJ-" + at.UTC().Format("20060102")
	count := 1
	for _, project := range state.entities["projects"] {
		if strings.HasPrefix(stringValue(project["key"]), prefix) {
			count++
		}
	}
	goal := stringOr(body["goal"], stringValue(body["description"]))
	start := nullableString(stringOr(body["start_at"], stringValue(body["planned_start_at"])))
	now := timestamp(at)
	project := record{
		"id": newID(), "key": fmt.Sprintf("%s-%03d", prefix, count), "name": name, "goal": goal, "description": goal,
		"status": stringOr(body["status"], "planning"), "owner_name": stringOr(body["owner_name"], actor),
		"start_at": start, "planned_start_at": start, "target_at": nullableString(body["target_at"]),
		"tags": normalizeStrings(body["tags"]), "note": stringValue(body["note"]),
		"review_markdown":     stringOr(body["review_markdown"], stringValue(body["note"])),
		"default_workflow_id": nullableString(body["default_workflow_id"]), "color": stringOr(body["color"], "primary"),
		"icon": stringOr(body["icon"], "flag"), "favorite": truthy(body["favorite"]), "created_at": now, "updated_at": now,
	}
	state.entities["projects"] = append([]record{project}, state.entities["projects"]...)
	return state.projectRead(project, at), nil
}

func updateTextFields(item, body record, fields ...string) {
	for _, key := range fields {
		if value, ok := body[key]; ok {
			item[key] = stringValue(value)
		}
	}
}

func updateNullableFields(item, body record, fields ...string) {
	for _, key := range fields {
		if value, ok := body[key]; ok {
			item[key] = nullableString(value)
		}
	}
}

func updateProject(project, body record, now string) {
	updateTextFields(project, body, "name", "owner_name", "note", "review_markdown", "status")
	updateNullableFields(project, body, "target_at", "default_workflow_id")
	if value, ok := firstProvided(body, "goal", "description"); ok {
		project["goal"], project["description"] = stringValue(value), stringValue(value)
	}
	if value, ok := firstProvided(body, "start_at", "planned_start_at"); ok {
		time := nullableString(value)
		project["start_at"], project["planned_start_at"] = time, time
	}
	if value, ok := body["tags"]; ok {
		project["tags"] = normalizeStrings(value)
	}
	if value, ok := body["color"]; ok {
		project["color"] = stringOr(value, "primary")
	}
	if value, ok := body["icon"]; ok {
		project["icon"] = stringOr(value, "flag")
	}
	if value, ok := body["favorite"]; ok {
		project["favorite"] = truthy(value)
	}
	project["updated_at"] = now
}

func (state *workflowState) projectAnalytics(project record, now time.Time) record {
	tickets := matchingRecords(state.entities["tickets"], "project_id", project["id"])
	stats := stateCounts(tickets, "status")
	midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	byDay := make(map[string][]record)
	durations := []float64{}
	var totalDuration float64
	late := 0
	for _, ticket := range tickets {
		created := scheduleTimestamp(ticket["created_at"])
		day := created.UTC().Format(time.DateOnly)
		byDay[day] = append(byDay[day], ticket)
		if ticket["status"] == "completed" {
			updated := scheduleTimestamp(ticket["updated_at"])
			duration := 0.0
			if !created.IsZero() && !updated.IsZero() {
				duration = max(0, updated.Sub(created).Hours())
			}
			durations = append(durations, duration)
			totalDuration += duration
		}
		if !terminalTicket(ticket["status"]) && overdue(ticket["due_at"], now) {
			late++
		}
	}
	trend := make([]record, 0, 14)
	completedInTrend := 0
	for offset := -13; offset <= 0; offset++ {
		day := midnight.AddDate(0, 0, offset).UTC().Format(time.DateOnly)
		items := byDay[day]
		completed := stateCounts(items, "status")["completed"]
		completedInTrend += completed
		trend = append(trend, record{"date": day, "created": len(items), "completed": completed})
	}
	slices.Sort(durations)
	mean, median, p75 := 0.0, 0.0, 0.0
	if len(durations) != 0 {
		mean = totalDuration / float64(len(durations))
		median = durations[(len(durations)-1)/2]
		p75 = durations[(len(durations)-1)*3/4]
	}
	return record{
		"project": state.projectRead(project, now), "status_counts": stats, "priority_counts": stateCounts(tickets, "priority"),
		"trend": trend, "velocity": stats["completed"], "daily_velocity": float64(completedInTrend) / 14,
		"blocked_count": stats["blocked"], "overdue_count": late,
		"duration_hours": record{"average": mean, "median": median, "p75": p75},
		"node_durations": []record{}, "path_distribution": []record{},
	}
}

func (state *workflowState) milestoneRead(item record) record {
	result := maps.Clone(item)
	tickets := matchingRecords(state.entities["tickets"], "milestone_id", item["id"])
	completed := stateCounts(tickets, "status")["completed"]
	result["goal"] = defaultValue(item["goal"], item["description"])
	result["review_markdown"] = defaultValue(item["review_markdown"], item["review"])
	result["completion_criteria"] = defaultValue(item["completion_criteria"], "")
	result["risk_note"] = defaultValue(item["risk_note"], "")
	result["owner_name"] = item["owner_name"]
	result["manual_progress"] = defaultValue(item["manual_progress"], item["progress"])
	result["ticket_count"], result["completed_ticket_count"] = len(tickets), completed
	if item["progress_mode"] != "manual" && len(tickets) > 0 {
		result["progress"] = percent(completed, len(tickets))
	}
	return result
}

func milestoneStatus(raw string) string {
	switch raw {
	case "planned":
		return "pending"
	case "active":
		return "in_progress"
	default:
		return raw
	}
}

func milestoneProgressMode(raw any) string {
	if raw == "manual" {
		return "manual"
	}
	return "ticket"
}

func (state *workflowState) createMilestone(projectID string, body record, now string) (record, error) {
	name := stringValue(body["name"])
	if name == "" {
		return nil, failure(422, "里程碑名称不能为空")
	}
	goal := stringOr(body["goal"], stringValue(body["description"]))
	review := stringOr(body["review_markdown"], stringValue(body["review"]))
	mode := milestoneProgressMode(body["progress_mode"])
	manual := max(0, min(100, numberOrZero(defaultValue(body["manual_progress"], body["progress"]))))
	progress := 0.0
	if mode == "manual" {
		progress = manual
	}
	item := record{
		"id": newID(), "project_id": projectID, "name": name, "description": goal, "goal": goal,
		"status": milestoneStatus(stringOr(body["status"], "pending")), "owner_name": nullableString(body["owner_name"]),
		"target_at": nullableString(body["target_at"]), "progress_mode": mode, "progress": progress, "manual_progress": manual,
		"completion_criteria": stringValue(body["completion_criteria"]), "risk_note": stringValue(body["risk_note"]),
		"review": review, "review_markdown": review, "notification_sent_at": nil, "created_at": now, "updated_at": now,
	}
	state.entities["milestones"] = append([]record{item}, state.entities["milestones"]...)
	return state.milestoneRead(item), nil
}

func updateMilestone(item, body record, now string) {
	updateTextFields(item, body, "name", "completion_criteria", "risk_note")
	updateNullableFields(item, body, "owner_name", "target_at")
	if value, ok := firstProvided(body, "goal", "description"); ok {
		item["goal"], item["description"] = stringValue(value), stringValue(value)
	}
	if value, ok := firstProvided(body, "review_markdown", "review"); ok {
		item["review_markdown"], item["review"] = stringValue(value), stringValue(value)
	}
	if value, ok := body["status"]; ok {
		item["status"] = milestoneStatus(stringValue(value))
	}
	if value, ok := body["progress_mode"]; ok {
		item["progress_mode"] = milestoneProgressMode(value)
	}
	if _, ok := firstProvided(body, "manual_progress", "progress"); ok {
		progress := max(0, min(100, numberOrZero(defaultValue(body["manual_progress"], body["progress"]))))
		item["manual_progress"] = progress
		if item["progress_mode"] == "manual" {
			item["progress"] = progress
		}
	}
	item["updated_at"] = now
}

func (state *workflowState) deleteMilestone(id string) {
	state.entities["milestones"] = removeMatching(state.entities["milestones"], "id", id)
	for _, ticket := range matchingRecords(state.entities["tickets"], "milestone_id", id) {
		ticket["milestone_id"] = nil
	}
	for _, resource := range state.entities["resources"] {
		resource["milestone_ids"] = slices.DeleteFunc(normalizeStrings(resource["milestone_ids"]), func(link string) bool { return link == id })
	}
}
