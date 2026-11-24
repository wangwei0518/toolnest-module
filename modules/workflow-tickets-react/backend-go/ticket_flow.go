package main

import (
	"fmt"
	"maps"
	"slices"
	"strings"
)

func terminalTicket(status any) bool {
	return status == "completed" || status == "cancelled" || status == "archived"
}

func finishedNode(status any) bool {
	return status == "completed" || status == "cancelled" || status == "skipped"
}

func normalizeStrings(value any) []string {
	result := []string{}
	if values, ok := value.([]string); ok {
		return append(result, values...)
	}
	seen := map[string]bool{}
	for _, item := range array(value) {
		if text := stringValue(item); text != "" && !seen[text] {
			result = append(result, text)
			seen[text] = true
		}
	}
	return result
}

func (state *workflowState) resolveScope(projectID, milestoneID string) (project, milestone record, err error) {
	if projectID != "" {
		project = findRecord(state.entities["projects"], projectID)
		if project == nil {
			return nil, nil, failure(404, "项目不存在")
		}
	}
	if milestoneID != "" {
		milestone = findRecord(state.entities["milestones"], milestoneID)
		if milestone == nil {
			return nil, nil, failure(404, "里程碑不存在")
		}
		if projectID != "" && milestone["project_id"] != projectID {
			return nil, nil, failure(422, "里程碑不属于当前项目")
		}
	}
	return project, milestone, nil
}

func (state *workflowState) createTicket(body record, actor, now string) (record, error) {
	workflow, err := state.workflow(stringValue(body["workflow_id"]))
	if err != nil {
		return nil, err
	}
	version := publishedVersion(workflow)
	if version == nil {
		return nil, failure(409, "只能基于已发布版本创建工单")
	}
	input := maps.Clone(body)
	input["owner_name"] = stringOr(body["owner_name"], actor)
	input["weight"] = max(1, min(100, numberOrZero(body["weight"])))
	return state.createInteractiveTicket(workflow, version, input, actor, now)
}

func (state *workflowState) createInteractiveTicket(workflow, version, input record, actor, now string) (record, error) {
	ticket, err := state.createTicketFromVersion(workflow, version, input, actor, now)
	if err != nil {
		return nil, err
	}
	for _, node := range rootInstances(ticket, version) {
		definition := findRecord(asRecords(version["nodes"]), stringValue(node["node_id"]))
		state.executeNodeActions(ticket, node, definition, "on_enter", now)
	}
	state.notifyTicket("ticket_created", fmt.Sprintf("工单「%s」已创建", ticket["title"]), ticket)
	return ticket, nil
}

func (state *workflowState) createTicketFromVersion(workflow, version, input record, actor, now string) (record, error) {
	title := stringValue(input["title"])
	if title == "" {
		return nil, failure(422, "工单标题不能为空")
	}
	projectID, milestoneID := stringValue(input["project_id"]), stringValue(input["milestone_id"])
	project, milestone, err := state.resolveScope(projectID, milestoneID)
	if err != nil {
		return nil, err
	}
	prefix := "TK"
	if project != nil {
		prefix = stringValue(project["key"])
	}
	sequence := 1
	for _, existing := range state.entities["tickets"] {
		if strings.HasPrefix(stringValue(existing["number"]), prefix+"-") {
			sequence++
		}
	}
	ticket := record{
		"id": newID(), "number": fmt.Sprintf("%s-%03d", prefix, sequence), "title": title,
		"note": stringValue(input["note"]), "status": "in_progress", "priority": stringOr(input["priority"], "none"),
		"tags": normalizeStrings(input["tags"]), "workflow_id": workflow["id"], "workflow_version_id": version["id"],
		"workflow_name": workflow["name"], "project_id": nullableString(projectID), "project_name": stringValue(project["name"]),
		"milestone_id": nullableString(milestoneID), "milestone_name": stringValue(milestone["name"]),
		"created_by": actor, "owner_id": nullableString(input["owner_id"]), "owner_name": nullableString(input["owner_name"]),
		"weight": max(1, numberOrZero(input["weight"])), "parent_ticket_id": nullableString(input["parent_ticket_id"]),
		"related_ticket_ids": normalizeStrings(input["related_ticket_ids"]), "blocked_by_ticket_ids": normalizeStrings(input["blocked_by_ticket_ids"]),
		"due_at": nullableString(input["due_at"]), "reminder_at": nullableString(input["reminder_at"]), "reminder_sent_at": nil,
		"created_at": now, "updated_at": now,
	}
	incoming := map[string]bool{}
	for _, edge := range asRecords(version["edges"]) {
		incoming[stringValue(edge["target_node_id"])] = true
	}
	nodeInstances := []record{}
	var first, firstDefinition record
	actionable := 0
	for _, definition := range asRecords(version["nodes"]) {
		nodeType := stringOr(definition["node_type"], "general")
		node := newTicketNode(definition)
		if nodeType != "summary" {
			actionable++
			if !incoming[stringValue(node["node_id"])] {
				node["status"] = "ready"
				if first == nil {
					first, firstDefinition = node, definition
				}
			}
		}
		nodeInstances = append(nodeInstances, node)
	}
	ticket["node_instances"] = nodeInstances
	if first != nil {
		first["values"] = maps.Clone(objectOrEmpty(input["initial_values"]))
		hydrateDefaults(ticket, first, firstDefinition)
		state.prepareRuntimeResources(ticket, first, firstDefinition, now)
	}
	if actionable == 0 {
		finishSummary(ticket, version, now)
		ticket["status"] = "completed"
		state.ticketEvent(ticket, nil, "ticket_completed", "工单已完成", now)
	}
	state.entities["tickets"] = append([]record{ticket}, state.entities["tickets"]...)
	state.ticketEvent(ticket, nil, "ticket_created", "工单已创建", now)
	return ticket, nil
}

func newTicketNode(definition record) record {
	return record{
		"id": newID(), "node_id": definition["id"], "name": definition["name"], "key": definition["key"],
		"node_type": stringOr(definition["node_type"], "general"), "status": "pending", "values": record{}, "outputs": []record{}, "resources": record{},
		"blocked_reason": "", "started_at": nil, "completed_at": nil, "assignee_id": nil, "assignee_name": nil,
	}
}

func (state *workflowState) ticketVersion(ticket record) record {
	workflow := findRecord(state.entities["workflows"], stringValue(ticket["workflow_id"]))
	return findRecord(asRecords(workflow["versions"]), stringValue(ticket["workflow_version_id"]))
}

func (state *workflowState) executableNode(ticketID, nodeID string) (ticket, node, version, definition record, err error) {
	ticket = findRecord(state.entities["tickets"], ticketID)
	if ticket == nil {
		err = failure(404, "工单不存在")
		return
	}
	if terminalTicket(ticket["status"]) {
		err = failure(409, "当前工单无法继续执行")
		return
	}
	for _, candidate := range asRecords(ticket["node_instances"]) {
		if candidate["id"] == nodeID || candidate["node_id"] == nodeID {
			node = candidate
			break
		}
	}
	if node == nil {
		err = failure(404, "工单节点不存在")
		return
	}
	version = state.ticketVersion(ticket)
	definition = findRecord(asRecords(version["nodes"]), stringValue(node["node_id"]))
	if definition == nil {
		err = failure(409, "工单节点定义不存在")
	} else if definition["node_type"] == "summary" {
		err = failure(409, fmt.Sprintf("总结节点「%s」是只读展示节点，不能执行流转操作", node["name"]))
	}
	return
}

func (state *workflowState) saveNode(ticketID, nodeID string, values record, now string) (record, error) {
	ticket, node, _, definition, err := state.executableNode(ticketID, nodeID)
	if err != nil {
		return nil, err
	}
	if node["status"] == "pending" {
		return nil, failure(409, "节点尚未满足前序条件")
	}
	fields := asRecords(asRecord(definition["form_schema"])["fields"])
	if problems := validateValues(fields, values, false); len(problems) > 0 {
		return nil, failure(422, strings.Join(problems, "；"))
	}
	node["values"] = values
	state.prepareRuntimeResources(ticket, node, definition, now)
	switch node["status"] {
	case "ready", "blocked", "waiting":
		node["status"] = "in_progress"
		if node["started_at"] == nil {
			node["started_at"] = now
		}
	}
	ticket["status"], ticket["updated_at"] = "in_progress", now
	state.ticketEvent(ticket, node, "field_submitted", fmt.Sprintf("节点「%s」已保存表单", node["name"]), now)
	return ticket, nil
}

func (state *workflowState) completeNode(ticketID, nodeID, now string) (record, error) {
	ticket, node, version, definition, err := state.executableNode(ticketID, nodeID)
	if err != nil {
		return nil, err
	}
	fields := asRecords(asRecord(definition["form_schema"])["fields"])
	values := asRecord(node["values"])
	if problems := validateValues(fields, values, true); len(problems) > 0 {
		state.executeNodeActions(ticket, node, definition, "on_fail", now)
		return nil, &committedFailure{failure(422, strings.Join(problems, "；"))}
	}
	if !state.evaluateRule(asRecord(definition["completion_rule"]), ticket, node) {
		state.executeNodeActions(ticket, node, definition, "on_fail", now)
		return nil, &committedFailure{failure(422, "完成条件尚未满足")}
	}
	node["status"], node["completed_at"] = "completed", now
	node["outputs"] = []record{{"key": "result", "value": maps.Clone(values)}}
	title := fmt.Sprintf("节点「%s」已完成", node["name"])
	state.ticketEvent(ticket, node, "node_completed", title, now)
	state.executeNodeActions(ticket, node, definition, "on_complete", now)
	state.notifyTicket("node_completed", title, ticket)
	activated := state.activateNodes(ticket, version, now, false)
	state.nodeEnteredActions(ticket, version, activated, now)
	if allActionableFinished(ticket, version) {
		finishSummary(ticket, version, now)
		ticket["status"] = "completed"
		state.ticketEvent(ticket, nil, "ticket_completed", "工单已完成", now)
		state.notifyTicket("ticket_completed", "工单已完成", ticket)
	} else {
		ticket["status"] = "in_progress"
		for _, ready := range activated {
			state.notifyTicket("node_ready", fmt.Sprintf("节点「%s」已进入待处理", ready["name"]), ticket)
		}
	}
	ticket["updated_at"] = now
	return ticket, nil
}

func (state *workflowState) nodeEnteredActions(ticket, version record, nodes []record, now string) {
	for _, node := range nodes {
		def := findRecord(asRecords(version["nodes"]), stringValue(node["node_id"]))
		state.executeNodeActions(ticket, node, def, "on_enter", now)
	}
}

func (state *workflowState) activateNodes(ticket, version record, now string, force bool) []record {
	return state.activateConnectedNodes(ticket, version, now, force, true)
}

func (state *workflowState) activateConnectedNodes(ticket, version record, now string, force, recordEvents bool) []record {
	var activated []record
	edges := asRecords(version["edges"])
	for _, node := range asRecords(ticket["node_instances"]) {
		if node["status"] != "pending" {
			continue
		}
		definition := findRecord(asRecords(version["nodes"]), stringValue(node["node_id"]))
		if definition == nil || definition["node_type"] == "summary" {
			continue
		}
		if !force && !predecessorsSatisfied(ticket, asRecord(definition["predecessor_rule"])) {
			continue
		}
		eligible := []record{}
		for _, edge := range edges {
			if edge["target_node_id"] != node["node_id"] {
				continue
			}
			source := nodeByDefinition(ticket, stringValue(edge["source_node_id"]))
			if source["status"] == "completed" {
				eligible = append(eligible, edge)
			}
		}
		slices.SortStableFunc(eligible, func(a, b record) int {
			return intCompare(numeric(a["priority"]), numeric(b["priority"]))
		})
		for _, edge := range eligible {
			mode := edge["condition_mode"]
			source := nodeByDefinition(ticket, stringValue(edge["source_node_id"]))
			satisfied := mode == "unconditional" || edge["condition"] == nil || state.evaluateRule(asRecord(edge["condition"]), ticket, source)
			if satisfied == (mode == "unless") {
				continue
			}
			node["status"] = "ready"
			hydrateDefaults(ticket, node, definition)
			if recordEvents || len(asRecord(node["resources"])) == 0 {
				state.prepareRuntimeResources(ticket, node, definition, now)
			}
			activated = append(activated, node)
			if recordEvents {
				state.ticketEvent(ticket, node, "node_ready", fmt.Sprintf("节点「%s」已进入待处理", node["name"]), now)
			}
			break
		}
	}
	return activated
}

func intCompare(left, right float64) int {
	if left < right {
		return -1
	}
	if left > right {
		return 1
	}
	return 0
}

func predecessorsSatisfied(ticket, rule record) bool {
	if rule == nil {
		return true
	}
	anyMatch := rule["operator"] == "OR"
	for _, condition := range asRecords(rule["conditions"]) {
		source := nodeByDefinition(ticket, stringValue(condition["node_id"]))
		statuses := normalizeStrings(condition["statuses"])
		if condition["statuses"] == nil {
			statuses = []string{stringOr(condition["status"], "completed")}
		}
		matches := source != nil && slices.Contains(statuses, stringValue(source["status"]))
		if (matches != truthy(condition["negate"])) == anyMatch {
			return anyMatch
		}
	}
	return !anyMatch
}

func allActionableFinished(ticket, version record) bool {
	for _, node := range asRecords(ticket["node_instances"]) {
		definition := findRecord(asRecords(version["nodes"]), stringValue(node["node_id"]))
		if definition["node_type"] != "summary" && !finishedNode(node["status"]) {
			return false
		}
	}
	return true
}

func finishSummary(ticket, version record, now string) {
	for _, node := range asRecords(ticket["node_instances"]) {
		definition := findRecord(asRecords(version["nodes"]), stringValue(node["node_id"]))
		if definition["node_type"] != "summary" {
			continue
		}
		hydrateDefaults(ticket, node, definition)
		node["status"], node["started_at"], node["completed_at"], node["blocked_reason"] = "completed", nil, now, ""
		node["outputs"] = []record{{"key": "result", "value": maps.Clone(asRecord(node["values"]))}}
	}
}

func (state *workflowState) ticketEvent(ticket, node record, eventType, title, now string) record {
	event := record{
		"id": newID(), "type": eventType, "title": title, "created_at": now, "actor_name": "当前用户",
		"node_id": node["node_id"], "ticket_id": ticket["id"], "project_id": ticket["project_id"], "milestone_id": ticket["milestone_id"],
	}
	state.entities["timeline"] = append([]record{event}, state.entities["timeline"]...)
	if ticket != nil && findRecord(state.entities["tickets"], stringValue(ticket["id"])) != nil {
		state.runAutomations(eventType, ticket, now)
	}
	return event
}
