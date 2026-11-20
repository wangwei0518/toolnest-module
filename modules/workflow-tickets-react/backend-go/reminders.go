package main

import (
	"fmt"
	"time"
)

func isDue(value any, at time.Time) bool {
	due := scheduleTimestamp(value)
	return !due.IsZero() && !due.After(at)
}

func (state *workflowState) runDueReminders(at time.Time) {
	now := timestamp(at)
	for _, ticket := range state.entities["tickets"] {
		status := ticket["status"]
		if (status != "draft" && status != "in_progress" && status != "blocked") ||
			truthy(ticket["reminder_sent_at"]) || !isDue(ticket["reminder_at"], at) {
			continue
		}
		ticket["reminder_sent_at"] = now
		state.ticketEvent(ticket, nil, "ticket_reminder_sent", "已发送工单提醒", now)
		state.notifyTicket("ticket_reminder", fmt.Sprintf("工单「%s」提醒", ticket["title"]), ticket)
	}
}

func (state *workflowState) runDueProjectNotifications(at time.Time) {
	now := timestamp(at)
	risk := map[string]bool{}
	for _, milestone := range state.entities["milestones"] {
		if !isDue(milestone["target_at"], at) || milestone["status"] == "completed" {
			continue
		}
		projectID := stringValue(milestone["project_id"])
		risk[projectID] = true
		if truthy(milestone["notification_sent_at"]) {
			continue
		}
		milestone["notification_sent_at"] = now
		title := "里程碑已到期：" + stringValue(milestone["name"])
		state.projectNotice("milestone_due", "milestone", stringValue(milestone["id"]), projectID, title, now)
	}
	for _, ticket := range state.entities["tickets"] {
		if ticket["status"] == "blocked" {
			risk[stringValue(ticket["project_id"])] = true
		}
	}
	for _, event := range state.entities["timeline"] {
		if event["type"] == "project_risk" {
			delete(risk, stringValue(event["project_id"]))
		}
	}
	for _, project := range state.entities["projects"] {
		id := stringValue(project["id"])
		if risk[id] {
			state.projectNotice("project_risk", "project", id, id, "项目存在风险："+stringValue(project["name"]), now)
		}
	}
}

func (state *workflowState) projectNotice(event, kind, id, project, title, now string) {
	entry := state.ticketEvent(nil, nil, event, title, now)
	entry["project_id"] = project
	if kind == "milestone" {
		entry["milestone_id"] = id
	}
	state.queueNotification(event, record{
		"title": title, "summary": project, "content": title, "source_type": kind, "source_id": id,
		"related_url": "/modules/" + workflowModuleID + "/projects/" + project,
	})
}
