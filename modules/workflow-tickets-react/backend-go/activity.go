package main

import (
	"maps"
	"net/http"
	"regexp"
	"slices"
	"time"
)

func (state *workflowState) overview(now time.Time) record {
	tickets := sortedUpdated(state.entities["tickets"])
	todo, inProgress, today := []record{}, []record{}, []record{}
	tomorrow := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, now.Location())
	for _, ticket := range tickets {
		if len(todo) < 5 && slices.ContainsFunc(asRecords(ticket["node_instances"]), func(node record) bool {
			return node["status"] == "ready" || node["status"] == "in_progress" || node["status"] == "waiting" || node["status"] == "blocked"
		}) {
			todo = append(todo, state.ticketRead(ticket))
		}
		active := ticket["status"] == "in_progress" || ticket["status"] == "blocked"
		if active && len(inProgress) < 5 {
			inProgress = append(inProgress, state.ticketRead(ticket))
		}
		if (active || ticket["status"] == "draft") && len(today) < 5 && (overdue(ticket["due_at"], tomorrow) || overdue(ticket["reminder_at"], tomorrow)) {
			today = append(today, state.ticketRead(ticket))
		}
	}
	return record{
		"todo": todo, "in_progress": inProgress, "today": today, "timeline": state.entities["timeline"][:min(8, len(state.entities["timeline"]))],
		"counts": stateCounts(tickets, "status"), "schedule_item_count": stateCounts(state.entities["schedule_items"], "status")["pending"],
		"project_counts": stateCounts(state.entities["projects"], "status"),
	}
}

type timelineScope struct {
	ticket, project, milestone       string
	projectTickets, milestoneTickets map[string]bool
}

func (state *workflowState) timelineScope(ticketID, projectID, milestoneID string) (timelineScope, error) {
	scope := timelineScope{
		ticket: ticketID, project: projectID, milestone: milestoneID,
		projectTickets: map[string]bool{}, milestoneTickets: map[string]bool{},
	}
	if _, _, err := state.resolveScope(projectID, ""); err != nil {
		return scope, err
	}
	if _, _, err := state.resolveScope("", milestoneID); err != nil {
		return scope, err
	}
	for _, ticket := range state.entities["tickets"] {
		id := stringValue(ticket["id"])
		if ticket["project_id"] == projectID {
			scope.projectTickets[id] = true
		}
		if ticket["milestone_id"] == milestoneID {
			scope.milestoneTickets[id] = true
		}
	}
	return scope, nil
}

func (scope timelineScope) includes(event record) bool {
	ticket := stringValue(event["ticket_id"])
	return (scope.ticket == "" || ticket == scope.ticket) &&
		(scope.project == "" || event["project_id"] == scope.project || scope.projectTickets[ticket]) &&
		(scope.milestone == "" || event["milestone_id"] == scope.milestone || scope.milestoneTickets[ticket])
}

func (state *workflowState) timeline(scope timelineScope, limit int) []record {
	result := []record{}
	for _, event := range state.entities["timeline"] {
		if scope.includes(event) {
			result = append(result, event)
			if len(result) >= limit {
				break
			}
		}
	}
	return result
}

type activityDay struct {
	count   int
	samples []string
	tickets []record
	seen    map[string]bool
}

func (day *activityDay) addTicket(ticket record) {
	id := stringValue(ticket["id"])
	if day.seen[id] {
		return
	}
	day.seen[id] = true
	day.tickets = append(day.tickets, record{"id": id, "number": ticket["number"], "title": ticket["title"]})
}

func (state *workflowState) timelineActivity(scope timelineScope, since, until, zone string, now time.Time) (record, error) {
	start, end := scheduleTimestamp(since), scheduleTimestamp(until)
	if (since != "" && start.IsZero()) || (until != "" && end.IsZero()) ||
		(!start.IsZero() && !end.IsZero() && !end.After(start)) {
		return nil, failure(400, "时间线日期范围无效")
	}
	location := scheduleLocation(zone)
	localDay := func(at time.Time) time.Time {
		local := at.In(location)
		return time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, time.UTC)
	}
	days := map[string]*activityDay{}
	getDay := func(date string) *activityDay {
		if days[date] == nil {
			days[date] = &activityDay{samples: []string{}, seen: map[string]bool{}}
		}
		return days[date]
	}
	tickets := make(map[string]record, len(state.entities["tickets"]))
	for _, ticket := range state.entities["tickets"] {
		tickets[stringValue(ticket["id"])] = ticket
	}
	total := 0
	for _, event := range state.entities["timeline"] {
		at := scheduleTimestamp(event["created_at"])
		if !scope.includes(event) || at.IsZero() || at.Before(start) || (!end.IsZero() && !at.Before(end)) {
			continue
		}
		day := getDay(localDay(at).Format(time.DateOnly))
		day.count++
		total++
		title := stringValue(event["title"])
		if len(day.samples) < 2 && !slices.Contains(day.samples, title) {
			day.samples = append(day.samples, title)
		}
		if ticket := tickets[stringValue(event["ticket_id"])]; ticket["status"] == "in_progress" {
			day.addTicket(ticket)
		}
	}
	last := localDay(now).AddDate(0, 0, 1)
	if !end.IsZero() && localDay(end).Before(last) {
		last = localDay(end)
	}
	for _, ticket := range state.entities["tickets"] {
		if ticket["status"] != "in_progress" || (scope.project != "" && !scope.projectTickets[stringValue(ticket["id"])]) {
			continue
		}
		created := scheduleTimestamp(ticket["created_at"])
		if created.IsZero() {
			continue
		}
		first := localDay(created)
		if !start.IsZero() && localDay(start).After(first) {
			first = localDay(start)
		}
		for date := first; date.Before(last); date = date.AddDate(0, 0, 1) {
			getDay(date.Format(time.DateOnly)).addTicket(ticket)
		}
	}
	result := make([]record, 0, len(days))
	for _, date := range slices.Sorted(maps.Keys(days)) {
		day := days[date]
		item := record{"date": date, "count": day.count, "samples": day.samples}
		if len(day.tickets) != 0 {
			item["tickets"] = day.tickets
		}
		result = append(result, item)
	}
	return record{"total": total, "days": result}, nil
}

var sensitiveField = regexp.MustCompile(`(?i)password|passwd|secret|token|api[_-]?key|credential`)

func maskValue(value any, key string) any {
	if sensitiveField.MatchString(key) {
		return "******"
	}
	if item := asRecord(value); item != nil {
		result := make(record, len(item))
		for field, item := range item {
			result[field] = maskValue(item, field)
		}
		return result
	}
	switch values := value.(type) {
	case []any:
		result := make([]any, len(values))
		for i, item := range values {
			result[i] = maskValue(item, key)
		}
		return result
	case []record:
		result := make([]any, len(values))
		for i, item := range values {
			result[i] = maskValue(item, key)
		}
		return result
	default:
		return value
	}
}

func (state *workflowState) diagnostics(ticket record) (record, error) {
	version := state.ticketVersion(ticket)
	if version == nil {
		return nil, failure(409, "工单绑定版本不存在")
	}
	nodes, edges, actions := []record{}, []record{}, []record{}
	for _, node := range asRecords(ticket["node_instances"]) {
		nodes = append(nodes, record{
			"id": node["node_id"], "name": node["name"], "status": node["status"], "assignee": node["assignee_name"],
			"blocked_reason": node["blocked_reason"], "values": maskValue(node["values"], ""), "outputs": maskValue(node["outputs"], ""),
		})
	}
	for _, edge := range asRecords(version["edges"]) {
		source := findRecord(nodes, stringValue(edge["source_node_id"]))
		target := findRecord(nodes, stringValue(edge["target_node_id"]))
		targetActive := target != nil && target["status"] != "pending"
		explanation := "目标节点尚未激活，可能未满足条件或仍在等待前序节点"
		if targetActive {
			explanation = "目标节点已进入流程"
		}
		edges = append(edges, record{
			"id": edge["id"], "source": defaultValue(source["name"], edge["source_node_id"]),
			"target": defaultValue(target["name"], edge["target_node_id"]), "condition": maskValue(edge["condition"], ""),
			"selected": targetActive && source != nil && source["status"] != "pending", "explanation": explanation,
		})
	}
	for _, execution := range matchingRecords(state.entities["action_executions"], "ticket_id", ticket["id"]) {
		item := maps.Clone(execution)
		item["input"], item["output"] = maskValue(item["input"], ""), maskValue(item["output"], "")
		actions = append(actions, item)
	}
	return record{"version": version["version"], "nodes": nodes, "edges": edges, "actions": actions}, nil
}

func (app *api) registerActivity(mux *http.ServeMux) {
	app.endpoint(mux, "GET /overview", false, func(state *workflowState, _ *http.Request, _ record) (any, error) {
		return state.overview(time.Now()), nil
	})
	app.endpoint(mux, "GET /timeline", false, func(state *workflowState, request *http.Request, _ record) (any, error) {
		query := request.URL.Query()
		if query.Get("aggregate") == "day" {
			scope, err := state.timelineScope("", query.Get("project_id"), "")
			if err != nil {
				return nil, err
			}
			return state.timelineActivity(scope, query.Get("since"), query.Get("until"), query.Get("timezone"), time.Now())
		}
		scope, err := state.timelineScope(query.Get("ticket_id"), query.Get("project_id"), query.Get("milestone_id"))
		if err != nil {
			return nil, err
		}
		return state.timeline(scope, positiveQuery(query.Get("limit"), 30)), nil
	})
	app.endpoint(mux, "GET /tickets/{ticketID}/diagnostics", false, func(state *workflowState, request *http.Request, _ record) (any, error) {
		ticket, err := findTicket(state, request.PathValue("ticketID"))
		if err != nil {
			return nil, err
		}
		return state.diagnostics(ticket)
	})
}
