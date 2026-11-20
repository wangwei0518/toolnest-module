package main

import (
	"maps"
	"net/http"
	"time"
)

func (state *workflowState) createScheduleItem(body record, actor, now string) (record, error) {
	title := stringValue(body["title"])
	if title == "" {
		return nil, failure(422, "事项标题不能为空")
	}
	item := record{
		"id": newID(), "title": title, "note": stringValue(body["note"]), "status": "pending",
		"owner_id": nullableString(body["owner_id"]), "owner_name": stringOr(body["owner_name"], actor),
		"due_at": nullableString(body["due_at"]), "reminder_at": nullableString(body["reminder_at"]), "ticket_id": nil,
		"created_at": now, "updated_at": now,
	}
	state.entities["schedule_items"] = append([]record{item}, state.entities["schedule_items"]...)
	return item, nil
}

func updateScheduleItem(item, body record, now string) record {
	if completed, ok := body["completed"]; ok {
		item["status"] = "pending"
		if truthy(completed) {
			item["status"] = "completed"
		}
	}
	updateTextFields(item, body, "title")
	item["updated_at"] = now
	return item
}

func (state *workflowState) convertScheduleItem(item, body record, actor, now string) (record, error) {
	if item["status"] != "pending" {
		return nil, failure(409, "当前日程事项无法转换")
	}
	workflow, err := state.workflow(stringValue(body["workflow_id"]))
	if err != nil {
		return nil, err
	}
	version := publishedVersion(workflow)
	if version == nil {
		return nil, failure(409, "只能基于已发布版本创建工单")
	}
	input := maps.Clone(item)
	for _, key := range []string{"project_id", "milestone_id", "priority"} {
		input[key] = body[key]
	}
	ticket, err := state.createInteractiveTicket(workflow, version, input, actor, now)
	if err != nil {
		return nil, err
	}
	item["status"], item["ticket_id"], item["updated_at"] = "converted", ticket["id"], now
	return ticket, nil
}

func (app *api) registerScheduleItems(mux *http.ServeMux) {
	app.endpoint(mux, "GET /schedule-items", false, func(state *workflowState, request *http.Request, _ record) (any, error) {
		includeArchived := request.URL.Query().Get("include_archived") != ""
		result := []record{}
		for _, item := range sortedUpdated(state.entities["schedule_items"]) {
			if includeArchived || item["status"] == "pending" || item["status"] == "completed" {
				result = append(result, item)
			}
		}
		return result, nil
	})
	app.endpoint(mux, "POST /schedule-items", true, func(state *workflowState, request *http.Request, body record) (any, error) {
		return state.createScheduleItem(body, actorName(request), timestamp(time.Now()))
	})
	for _, route := range []struct {
		method, suffix string
		handle         func(*workflowState, record, record, string, string) (any, error)
	}{
		{"PUT", "", func(_ *workflowState, item, body record, _, now string) (any, error) {
			return updateScheduleItem(item, body, now), nil
		}},
		{"POST", "/completion", func(_ *workflowState, item, body record, _, now string) (any, error) {
			return updateScheduleItem(item, record{"completed": defaultValue(body["completed"], true)}, now), nil
		}},
		{"POST", "/archive", func(_ *workflowState, item, _ record, _, now string) (any, error) {
			if item["status"] == "converted" {
				return nil, failure(409, "已转换事项不能归档")
			}
			item["status"], item["updated_at"] = "archived", now
			return item, nil
		}},
		{"POST", "/convert", func(state *workflowState, item, body record, actor, now string) (any, error) {
			ticket, err := state.convertScheduleItem(item, body, actor, now)
			if err != nil {
				return nil, err
			}
			return app.ticketDetail(state, ticket), nil
		}},
	} {
		app.endpoint(mux, route.method+" /schedule-items/{itemID}"+route.suffix, true, func(state *workflowState, request *http.Request, body record) (any, error) {
			item := findRecord(state.entities["schedule_items"], request.PathValue("itemID"))
			if item == nil {
				return nil, failure(404, "日程事项不存在")
			}
			return route.handle(state, item, body, actorName(request), timestamp(time.Now()))
		})
	}
}
