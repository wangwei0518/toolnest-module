package main

import (
	"fmt"
	"maps"
	"net/http"
	"slices"
	"strings"
	"time"
	"unicode/utf16"
)

func canonicalTrigger(raw string) string {
	switch raw {
	case "ticket_blocked":
		return "node_blocked"
	case "ticket_reminder_sent":
		return "ticket_reminder"
	default:
		return raw
	}
}

func validPriority(value string) bool {
	return slices.Contains([]string{"none", "low", "medium", "high", "urgent"}, value)
}

func (state *workflowState) normalizeAutomation(input record) (record, error) {
	name := stringValue(input["name"])
	if name == "" {
		return nil, failure(422, "规则名称不能为空")
	}
	trigger := canonicalTrigger(stringOr(input["trigger"], "ticket_created"))
	switch trigger {
	case "ticket_created", "ticket_completed", "ticket_cancelled", "ticket_reopened", "node_ready", "node_completed", "node_blocked", "ticket_reminder":
	default:
		return nil, failure(422, "自动化触发事件无效")
	}
	conditions := maps.Clone(objectOrEmpty(input["conditions"]))
	projectID := stringValue(conditions["project_id"])
	for _, field := range []string{"workflow_id", "project_id", "priority", "status"} {
		value := stringValue(conditions[field])
		if value == "" {
			delete(conditions, field)
			continue
		}
		conditions[field] = value
		switch field {
		case "workflow_id":
			if _, err := state.workflow(value); err != nil {
				return nil, err
			}
		case "project_id":
			if _, _, err := state.resolveScope(value, ""); err != nil {
				return nil, err
			}
		case "priority":
			if !validPriority(value) {
				return nil, failure(422, "自动化优先级无效")
			}
		case "status":
			if !slices.Contains([]string{"draft", "in_progress", "blocked", "completed", "cancelled", "archived"}, value) {
				return nil, failure(422, "自动化工单状态无效")
			}
		}
	}
	rawActions := asRecords(input["actions"])
	if len(rawActions) == 0 {
		return nil, failure(422, "至少配置一个自动化动作")
	}
	if len(rawActions) > 20 {
		return nil, failure(422, "单条规则最多配置 20 个动作")
	}
	actions := make([]record, 0, len(rawActions))
	actionProject, milestoneProject := "", ""
	for i, raw := range rawActions {
		action := maps.Clone(objectOrEmpty(raw))
		kind := stringValue(raw["type"])
		value := stringValue(defaultValue(raw["value"], defaultValue(raw["project_id"], raw["milestone_id"])))
		bad := func(message string) (record, error) {
			return nil, failure(422, fmt.Sprintf("第 %d 个%s", i+1, message))
		}
		switch kind {
		case "set_priority":
			if !validPriority(value) {
				return bad("动作的优先级无效")
			}
		case "add_tag":
			if value == "" || len(utf16.Encode([]rune(value))) > 50 {
				return bad("动作的标签不能为空且不能超过 50 个字符")
			}
		case "set_project":
			if value == "" {
				return bad("动作必须选择项目")
			}
			if _, _, err := state.resolveScope(value, ""); err != nil {
				return nil, err
			}
			actionProject = value
		case "set_milestone":
			if value == "" {
				return bad("动作必须选择里程碑")
			}
			_, item, err := state.resolveScope("", value)
			if err != nil {
				return nil, err
			}
			milestoneProject = stringValue(item["project_id"])
			if projectID != "" && milestoneProject != projectID {
				return bad("里程碑不属于限定项目")
			}
		case "set_due_at":
			if scheduleTimestamp(value).IsZero() {
				return bad("动作的目标时间无效")
			}
		case "archive":
		default:
			return bad("自动化动作无效")
		}
		action["type"] = kind
		if kind == "archive" {
			delete(action, "value")
		} else {
			action["value"] = value
		}
		actions = append(actions, action)
	}
	if actionProject != "" && milestoneProject != "" && actionProject != milestoneProject {
		return nil, failure(422, "关联项目与里程碑不属于同一项目")
	}
	return record{"name": name, "enabled": input["enabled"] == true, "trigger": trigger, "conditions": conditions, "actions": actions}, nil
}

func (state *workflowState) applyAutomationAction(action, ticket record) error {
	value := nullableString(action["value"])
	switch action["type"] {
	case "set_priority":
		ticket["priority"] = stringValue(value)
	case "add_tag":
		tags := normalizeStrings(ticket["tags"])
		tag := stringValue(value)
		if tag != "" && !slices.Contains(tags, tag) {
			tags = append(tags, tag)
		}
		ticket["tags"] = tags
	case "set_project":
		value = defaultValue(value, nullableString(action["project_id"]))
		if _, _, err := state.resolveScope(stringValue(value), stringValue(ticket["milestone_id"])); err != nil {
			return err
		}
		ticket["project_id"] = value
	case "set_milestone":
		value = defaultValue(value, nullableString(action["milestone_id"]))
		if _, _, err := state.resolveScope(stringValue(ticket["project_id"]), stringValue(value)); err != nil {
			return err
		}
		ticket["milestone_id"] = value
	case "set_due_at":
		ticket["due_at"] = value
	case "archive":
		ticket["status"] = "archived"
	}
	return nil
}

func (state *workflowState) runAutomations(event string, ticket record, now string) {
	trigger := canonicalTrigger(event)
	for _, rule := range state.entities["automations"] {
		if !truthy(rule["enabled"]) || canonicalTrigger(stringValue(rule["trigger"])) != trigger {
			continue
		}
		conditions := objectOrEmpty(rule["conditions"])
		if slices.ContainsFunc([]string{"workflow_id", "project_id", "priority", "status"}, func(field string) bool {
			wanted := stringValue(conditions[field])
			return wanted != "" && ticket[field] != wanted
		}) {
			continue
		}
		provider := "automation:" + stringValue(rule["id"])
		if slices.ContainsFunc(state.entities["action_executions"], func(item record) bool {
			return item["ticket_id"] == ticket["id"] && item["provider_key"] == provider &&
				canonicalTrigger(stringValue(item["event"])) == trigger
		}) {
			continue
		}
		actions := asRecords(rule["actions"])
		status, fail := "succeeded", any(nil)
		applied := 0
		for _, action := range actions {
			if err := state.applyAutomationAction(action, ticket); err != nil {
				status, fail = "failed", err.Error()
				break
			}
			applied++
		}
		if fail == nil {
			ticket["updated_at"] = now
		}
		state.entities["action_executions"] = append(state.entities["action_executions"], record{
			"id": newID(), "ticket_id": ticket["id"], "node_id": nil, "provider_key": provider, "event": trigger,
			"status": status, "input": conditions, "output": record{"applied": applied, "total": len(actions)},
			"error": fail, "created_at": now, "completed_at": now,
		})
	}
}

func (app *api) registerAutomations(mux *http.ServeMux) {
	app.endpoint(mux, "GET /automations", false, func(state *workflowState, _ *http.Request, _ record) (any, error) {
		result := []record{}
		for _, rule := range sortedUpdated(state.entities["automations"]) {
			item := maps.Clone(rule)
			item["trigger"] = canonicalTrigger(stringValue(item["trigger"]))
			result = append(result, item)
		}
		return result, nil
	})
	app.endpoint(mux, "POST /automations", true, func(state *workflowState, _ *http.Request, body record) (any, error) {
		item, err := state.normalizeAutomation(body)
		if err != nil {
			return nil, err
		}
		now := timestamp(time.Now())
		item["id"], item["created_at"], item["updated_at"] = newID(), now, now
		state.entities["automations"] = append([]record{item}, state.entities["automations"]...)
		return item, nil
	})
	app.endpoint(mux, "PUT /automations/{ruleID}", true, func(state *workflowState, request *http.Request, body record) (any, error) {
		item := findRecord(state.entities["automations"], request.PathValue("ruleID"))
		if item == nil {
			return nil, failure(404, "自动化规则不存在")
		}
		input := maps.Clone(item)
		maps.Copy(input, body)
		normalized, err := state.normalizeAutomation(input)
		if err != nil {
			return nil, err
		}
		maps.Copy(item, normalized)
		item["updated_at"] = timestamp(time.Now())
		return item, nil
	})
	app.endpoint(mux, "DELETE /automations/{ruleID}", true, func(state *workflowState, request *http.Request, _ record) (any, error) {
		id := request.PathValue("ruleID")
		if findRecord(state.entities["automations"], id) == nil {
			return nil, failure(404, "自动化规则不存在")
		}
		state.entities["automations"] = removeMatching(state.entities["automations"], "id", id)
		return nil, nil
	})
	app.endpoint(mux, "GET /automations/{ruleID}/executions", false, func(state *workflowState, request *http.Request, _ record) (any, error) {
		id := request.PathValue("ruleID")
		if findRecord(state.entities["automations"], id) == nil {
			return nil, failure(404, "自动化规则不存在")
		}
		items := matchingRecords(state.entities["action_executions"], "provider_key", "automation:"+id)
		slices.SortStableFunc(items, func(a, b record) int {
			return strings.Compare(stringValue(b["created_at"]), stringValue(a["created_at"]))
		})
		limit := min(100, positiveQuery(request.URL.Query().Get("limit"), 30))
		result := []record{}
		for _, item := range items[:min(limit, len(items))] {
			entry := maps.Clone(item)
			ticket := findRecord(state.entities["tickets"], stringValue(item["ticket_id"]))
			entry["ticket_title"], entry["ticket_number"] = defaultValue(ticket["title"], "工单已删除"), defaultValue(ticket["number"], "未知工单")
			result = append(result, entry)
		}
		return result, nil
	})
}
