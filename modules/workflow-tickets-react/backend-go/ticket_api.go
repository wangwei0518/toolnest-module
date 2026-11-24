package main

import (
	"maps"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"
)

func actorName(request *http.Request) string {
	return stringOr(request.Header.Get("X-ToolNest-User-Name"), "当前用户")
}

func (state *workflowState) ticketRead(ticket record) record {
	result := maps.Clone(ticket)
	for _, pair := range []struct{ collection, key, name string }{
		{"workflows", "workflow_id", "workflow_name"}, {"projects", "project_id", "project_name"},
		{"milestones", "milestone_id", "milestone_name"},
	} {
		if related := findRecord(state.entities[pair.collection], stringValue(ticket[pair.key])); related != nil {
			result[pair.name] = related["name"]
		} else if result[pair.name] == nil && pair.collection != "workflows" {
			result[pair.name] = ""
		}
	}
	if result["weight"] == nil {
		result["weight"] = 1
	}
	for _, field := range []string{"related_ticket_ids", "blocked_by_ticket_ids"} {
		if result[field] == nil {
			result[field] = []string{}
		}
	}
	definitions := asRecords(state.ticketVersion(ticket)["nodes"])
	instances := []record{}
	var summaries []record
	actionable, finished := 0, 0
	for _, item := range asRecords(ticket["node_instances"]) {
		node := maps.Clone(item)
		definition := findRecord(definitions, stringValue(node["node_id"]))
		node["node_type"] = stringOr(definition["node_type"], stringOr(node["node_type"], "general"))
		if node["node_type"] == "summary" {
			summaries = append(summaries, node)
		} else {
			actionable++
			if finishedNode(node["status"]) {
				finished++
			}
		}
		instances = append(instances, node)
	}
	result["node_instances"] = instances
	if len(summaries) > 0 && actionable > 0 && finished == actionable && (result["status"] == "in_progress" || result["status"] == "blocked") {
		result["status"] = "completed"
		for _, node := range summaries {
			node["status"], node["started_at"] = "completed", nil
			if node["completed_at"] == nil {
				node["completed_at"] = ticket["updated_at"]
			}
		}
	}
	return result
}

func (app *api) ticketDetail(state *workflowState, ticket record) record {
	detail := state.ticketRead(ticket)
	app.refreshTemporaryResources(state, detail)
	attachments := []record{}
	for _, item := range state.entities["attachments"] {
		if item["ticket_id"] == ticket["id"] {
			attachments = append(attachments, app.attachmentRead(item))
		}
	}
	detail["attachments"] = attachments
	return detail
}

func positiveQuery(raw string, fallback int) int {
	if number, err := strconv.Atoi(strings.TrimSpace(raw)); err == nil && number != 0 {
		return max(number, 1)
	}
	return fallback
}

func (state *workflowState) listTickets(query url.Values, ownerID, ownerName string, now time.Time) record {
	items := []record{}
	for _, ticket := range state.entities["tickets"] {
		if matchesTicket(ticket, query, ownerID, ownerName, now) {
			items = append(items, ticket)
		}
	}
	slices.SortStableFunc(items, func(a, b record) int {
		return strings.Compare(stringValue(b["updated_at"]), stringValue(a["updated_at"]))
	})
	page, size := positiveQuery(query.Get("page"), 1), min(100, positiveQuery(query.Get("page_size"), 100))
	total := len(items)
	result := []record{}
	if page-1 <= total/size {
		start := (page - 1) * size
		for _, item := range items[start:min(total, start+size)] {
			result = append(result, state.ticketRead(item))
		}
	}
	return record{"items": result, "total": total, "page": page, "page_size": size}
}

func matchesTicket(ticket record, query url.Values, ownerID, ownerName string, now time.Time) bool {
	for _, key := range []string{"status", "project_id", "milestone_id", "priority"} {
		if wanted := stringValue(query.Get(key)); wanted != "" && ticket[key] != wanted {
			return false
		}
	}
	keyword := strings.ToLower(stringValue(query.Get("keyword")))
	haystack := strings.ToLower(stringValue(ticket["number"]) + " " + stringValue(ticket["title"]) + " " + stringValue(ticket["note"]))
	if !strings.Contains(haystack, keyword) {
		return false
	}
	tag := strings.ToLower(stringValue(query.Get("tag")))
	if tag != "" && !slices.ContainsFunc(normalizeStrings(ticket["tags"]), func(value string) bool {
		return strings.Contains(strings.ToLower(value), tag)
	}) {
		return false
	}
	switch query.Get("view") {
	case "mine":
		if query.Has("owner_id") {
			ownerID = stringValue(query.Get("owner_id"))
		}
		if query.Has("owner_name") {
			ownerName = stringValue(query.Get("owner_name"))
		}
		return ticket["owner_id"] == ownerID || (!truthy(ticket["owner_id"]) && ticket["owner_name"] == ownerName)
	case "today":
		due := scheduleTimestamp(ticket["due_at"])
		return !due.IsZero() && due.In(now.Location()).Format(time.DateOnly) == now.Format(time.DateOnly)
	default:
		return true
	}
}

func (app *api) registerTickets(mux *http.ServeMux) {
	app.registerTicketEdits(mux)
	app.endpoint(mux, "GET /tickets", false, func(state *workflowState, request *http.Request, _ record) (any, error) {
		return state.listTickets(request.URL.Query(), request.Header.Get("X-ToolNest-User-ID"), actorName(request), time.Now()), nil
	})
	app.endpoint(mux, "GET /tickets/{ticketID}", false, func(state *workflowState, request *http.Request, _ record) (any, error) {
		ticket := findRecord(state.entities["tickets"], request.PathValue("ticketID"))
		if ticket == nil {
			return nil, failure(404, "工单不存在")
		}
		return app.ticketDetail(state, ticket), nil
	})
	app.endpoint(mux, "POST /tickets", true, func(state *workflowState, request *http.Request, body record) (any, error) {
		ticket, err := state.createTicket(body, actorName(request), timestamp(time.Now()))
		if err != nil {
			return nil, err
		}
		return app.ticketDetail(state, ticket), nil
	})
	app.endpoint(mux, "POST /tickets/{ticketID}/nodes/{nodeID}/save", true, func(state *workflowState, request *http.Request, body record) (any, error) {
		ticket, err := state.saveNode(request.PathValue("ticketID"), request.PathValue("nodeID"), objectOrEmpty(body["values"]), timestamp(time.Now()))
		if err != nil {
			return nil, err
		}
		return app.ticketDetail(state, ticket), nil
	})
	app.endpoint(mux, "POST /tickets/{ticketID}/nodes/{nodeID}/complete", true, func(state *workflowState, request *http.Request, _ record) (any, error) {
		ticket, err := state.completeNode(request.PathValue("ticketID"), request.PathValue("nodeID"), timestamp(time.Now()))
		if err != nil {
			return nil, err
		}
		return app.ticketDetail(state, ticket), nil
	})
	for _, route := range []struct {
		path string
		run  func(*workflowState, string, string, record, string) (record, error)
	}{
		{"/nodes/{nodeID}/block", func(state *workflowState, ticketID, nodeID string, body record, now string) (record, error) {
			return state.blockNode(ticketID, nodeID, stringValue(body["reason"]), now)
		}},
		{"/nodes/{nodeID}/rollback", func(state *workflowState, ticketID, nodeID string, body record, now string) (record, error) {
			return state.rollbackNode(ticketID, nodeID, stringValue(body["target_node_id"]), stringValue(body["reason"]), now)
		}},
		{"/cancel", func(state *workflowState, ticketID, _ string, body record, now string) (record, error) {
			return state.cancelTicket(ticketID, stringValue(body["reason"]), now)
		}},
		{"/reopen", func(state *workflowState, ticketID, _ string, _ record, now string) (record, error) {
			return state.reopenTicket(ticketID, now)
		}},
	} {
		app.endpoint(mux, "POST /tickets/{ticketID}"+route.path, true, func(state *workflowState, request *http.Request, body record) (any, error) {
			ticket, err := route.run(state, request.PathValue("ticketID"), request.PathValue("nodeID"), body, timestamp(time.Now()))
			if err != nil {
				return nil, err
			}
			return app.ticketDetail(state, ticket), nil
		})
	}
}

func (app *api) registerTicketEdits(mux *http.ServeMux) {
	app.endpoint(mux, "POST /tickets/bulk-update", true, func(state *workflowState, _ *http.Request, body record) (any, error) {
		items, err := state.bulkUpdateTickets(body, timestamp(time.Now()))
		if err != nil {
			return nil, err
		}
		result := make([]record, 0, len(items))
		for _, item := range items {
			result = append(result, app.ticketDetail(state, item))
		}
		return result, nil
	})
	for _, route := range []struct {
		pattern string
		run     func(*workflowState, record, *http.Request, record) (record, error)
	}{
		{"PUT /tickets/{ticketID}", func(state *workflowState, ticket record, _ *http.Request, body record) (record, error) {
			return state.updateTicket(ticket, body, timestamp(time.Now()))
		}},
		{"POST /tickets/{ticketID}/duplicate", func(state *workflowState, ticket record, request *http.Request, body record) (record, error) {
			return state.duplicateTicket(ticket, body, actorName(request), timestamp(time.Now()))
		}},
		{"POST /tickets/{ticketID}/upgrade-workflow", func(state *workflowState, ticket record, request *http.Request, body record) (record, error) {
			return state.upgradeTicketWorkflow(ticket, body, actorName(request), timestamp(time.Now()))
		}},
		{"DELETE /tickets/{ticketID}", func(state *workflowState, ticket record, _ *http.Request, _ record) (record, error) {
			for _, file := range matchingRecords(state.entities["attachments"], "ticket_id", ticket["id"]) {
				app.queueAttachmentRemoval(state, file)
			}
			state.deleteTicket(stringValue(ticket["id"]))
			return nil, nil
		}},
	} {
		app.endpoint(mux, route.pattern, true, func(state *workflowState, request *http.Request, body record) (any, error) {
			ticket, err := findTicket(state, request.PathValue("ticketID"))
			if err != nil {
				return nil, err
			}
			result, err := route.run(state, ticket, request, body)
			if err != nil || result == nil {
				return nil, err
			}
			return app.ticketDetail(state, result), nil
		})
	}
}
