package main

import (
	"maps"
	"slices"
)

func findTicket(state *workflowState, id string) (record, error) {
	if item := findRecord(state.entities["tickets"], id); item != nil {
		return item, nil
	}
	return nil, failure(404, "工单不存在")
}

func dropLink(item record, field, id string) {
	item[field] = slices.DeleteFunc(normalizeStrings(item[field]), func(link string) bool { return link == id })
}

func (state *workflowState) updateTicket(ticket, body record, now string) (record, error) {
	if _, statusProvided := body["status"]; terminalTicket(ticket["status"]) && !statusProvided {
		return nil, failure(409, "当前工单不能修改")
	}
	if value, ok := body["title"]; ok && stringValue(value) == "" {
		return nil, failure(422, "工单标题不能为空")
	}
	previous := stringValue(ticket["project_id"])
	_, _, err := state.resolveScope(stringOr(body["project_id"], previous), stringOr(body["milestone_id"], stringValue(ticket["milestone_id"])))
	if err != nil {
		return nil, err
	}
	updateTextFields(ticket, body, "title", "note", "priority")
	updateNullableFields(ticket, body, "owner_id", "owner_name", "due_at", "reminder_at", "project_id", "milestone_id", "parent_ticket_id")
	if value, ok := body["weight"]; ok {
		ticket["weight"] = max(1, min(100, numberOrZero(value)))
	}
	if value, ok := body["tags"]; ok {
		ticket["tags"] = normalizeStrings(value)
	}
	id := stringValue(ticket["id"])
	for _, field := range []string{"related_ticket_ids", "blocked_by_ticket_ids"} {
		if value, ok := body[field]; ok {
			ticket[field] = value
		}
		links := normalizeStrings(ticket[field])
		if err := state.validateTicketLinks(id, links); err != nil {
			return nil, err
		}
		ticket[field] = links
	}
	if parent := stringValue(ticket["parent_ticket_id"]); parent != "" {
		if err := state.validateTicketLinks(id, []string{parent}); err != nil {
			return nil, err
		}
	}
	due, reminder := scheduleTimestamp(ticket["due_at"]), scheduleTimestamp(ticket["reminder_at"])
	if !due.IsZero() && !reminder.IsZero() && reminder.After(due) {
		return nil, failure(422, "提醒时间不能晚于目标时间")
	}
	if stringValue(ticket["project_id"]) != previous {
		for _, resource := range state.entities["resources"] {
			dropLink(resource, "ticket_ids", id)
		}
	}
	ticket["updated_at"] = now
	state.ticketEvent(ticket, nil, "ticket_updated", "工单信息已更新", now)
	return ticket, nil
}

func (state *workflowState) validateTicketLinks(id string, links []string) error {
	for _, link := range links {
		if link == id {
			return failure(422, "工单不能关联自身")
		}
		if findRecord(state.entities["tickets"], link) == nil {
			return failure(422, "关联工单不存在")
		}
	}
	return nil
}

func (state *workflowState) duplicateTicket(original, body record, actor, now string) (record, error) {
	workflow, err := state.workflow(stringValue(original["workflow_id"]))
	if err != nil {
		return nil, err
	}
	version := findRecord(asRecords(workflow["versions"]), stringValue(original["workflow_version_id"]))
	if version == nil {
		return nil, failure(409, "工单绑定版本不存在")
	}
	input := maps.Clone(original)
	input["title"] = stringOr(body["title"], stringValue(original["title"])+"（副本）")
	for _, field := range []string{"note", "owner_id", "owner_name", "due_at", "reminder_at", "project_id", "milestone_id", "priority", "tags", "weight"} {
		if value, ok := body[field]; ok {
			input[field] = value
		}
	}
	if value, ok := body["owner_name"]; ok {
		input["owner_name"] = stringOr(value, actor)
	}
	if value, ok := body["weight"]; ok {
		input["weight"] = max(1, min(100, numberOrZero(value)))
	}
	if value, ok := body["copy_project"]; ok && !truthy(value) {
		input["project_id"], input["milestone_id"] = nil, nil
	}
	if !truthy(body["copy_relations"]) {
		input["parent_ticket_id"], input["related_ticket_ids"], input["blocked_by_ticket_ids"] = nil, nil, nil
	}
	input["initial_values"] = record{}
	if nodes := asRecords(original["node_instances"]); len(nodes) > 0 {
		if value, ok := body["copy_values"]; !ok || truthy(value) {
			input["initial_values"] = nodes[0]["values"]
		}
	}
	return state.createInteractiveTicket(workflow, version, input, actor, now)
}

func (state *workflowState) bulkUpdateTickets(body record, now string) ([]record, error) {
	ids := normalizeStrings(body["ticket_ids"])
	project, hasProject := body["project_id"]
	milestone, hasMilestone := body["milestone_id"]
	if hasProject || hasMilestone {
		if _, _, err := state.resolveScope(stringValue(project), stringValue(milestone)); err != nil {
			return nil, err
		}
	}
	extraTags := normalizeStrings(body["add_tags"])
	result := []record{}
	for _, ticket := range state.entities["tickets"] {
		id := stringValue(ticket["id"])
		if !slices.Contains(ids, id) {
			continue
		}
		previous := ticket["project_id"]
		updateNullableFields(ticket, body, "project_id", "milestone_id")
		updateTextFields(ticket, body, "priority")
		seen := map[string]bool{}
		ticket["tags"] = slices.DeleteFunc(append(normalizeStrings(ticket["tags"]), extraTags...), func(tag string) bool {
			exists := seen[tag]
			seen[tag] = true
			return exists
		})
		ticket["updated_at"] = now
		if ticket["project_id"] != previous {
			for _, resource := range state.entities["resources"] {
				dropLink(resource, "ticket_ids", id)
			}
		}
		result = append(result, ticket)
	}
	return result, nil
}

func (state *workflowState) deleteTicket(id string) {
	state.entities["tickets"] = removeMatching(state.entities["tickets"], "id", id)
	for _, collection := range []string{"timeline", "attachments", "temporary_resources", "action_executions"} {
		state.entities[collection] = removeMatching(state.entities[collection], "ticket_id", id)
	}
	for _, resource := range state.entities["resources"] {
		dropLink(resource, "ticket_ids", id)
	}
	for _, run := range matchingRecords(state.entities["schedule_runs"], "ticket_id", id) {
		run["ticket_id"] = nil
	}
}
