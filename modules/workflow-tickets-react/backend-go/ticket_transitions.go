package main

import (
	"fmt"
	"slices"
)

func (state *workflowState) blockNode(ticketID, nodeID, reason, now string) (record, error) {
	ticket, node, _, definition, err := state.executableNode(ticketID, nodeID)
	if err != nil {
		return nil, err
	}
	if reason == "" {
		return nil, failure(422, "请填写阻塞原因")
	}
	node["status"], node["blocked_reason"] = "blocked", reason
	ticket["status"], ticket["updated_at"] = "blocked", now
	state.ticketEvent(ticket, node, "node_blocked", fmt.Sprintf("节点「%s」已阻塞", node["name"]), now)["detail"] = reason
	state.executeNodeActions(ticket, node, definition, "on_block", now)
	state.notifyTicket("ticket_blocked", fmt.Sprintf("工单「%s」已阻塞", ticket["title"]), ticket)
	return ticket, nil
}

func (state *workflowState) cancelTicket(ticketID, reason, now string) (record, error) {
	ticket := findRecord(state.entities["tickets"], ticketID)
	if ticket == nil {
		return nil, failure(404, "工单不存在")
	}
	if terminalTicket(ticket["status"]) {
		return nil, failure(409, "当前工单无法终止")
	}
	for _, node := range asRecords(ticket["node_instances"]) {
		if node["status"] != "completed" && node["status"] != "skipped" {
			node["status"], node["blocked_reason"] = "cancelled", reason
		}
	}
	for _, resource := range matchingRecords(state.entities["temporary_resources"], "ticket_id", ticketID) {
		resource["revoked"] = true
	}
	ticket["status"], ticket["updated_at"] = "cancelled", now
	state.ticketEvent(ticket, nil, "ticket_cancelled", "工单已终止", now)["detail"] = reason
	state.notifyTicket("ticket_cancelled", fmt.Sprintf("工单「%s」已终止", ticket["title"]), ticket)
	return ticket, nil
}

func (state *workflowState) rollbackNode(ticketID, currentID, targetID, reason, now string) (record, error) {
	ticket, current, version, _, err := state.executableNode(ticketID, currentID)
	if err != nil {
		return nil, err
	}
	currentID = stringValue(current["node_id"])
	var target record
	if targetID != "" {
		_, target, _, _, err = state.executableNode(ticketID, targetID)
		if err != nil {
			return nil, err
		}
		targetID = stringValue(target["node_id"])
	}
	direct := []string{}
	outgoing := map[string][]string{}
	for _, edge := range asRecords(version["edges"]) {
		from, to := stringValue(edge["source_node_id"]), stringValue(edge["target_node_id"])
		outgoing[from] = append(outgoing[from], to)
		if to == currentID && nodeByDefinition(ticket, from)["status"] == "completed" {
			direct = append(direct, from)
		}
	}
	if targetID == "" {
		if len(direct) != 1 {
			return nil, failure(422, "多个前序节点已完成，请指定回退节点")
		}
		targetID = direct[0]
		target = nodeByDefinition(ticket, targetID)
	}
	if !slices.Contains(direct, targetID) {
		return nil, failure(422, "只能回退到当前节点的直接完成前序节点")
	}
	reachable := map[string]bool{}
	queue := []string{currentID}
	for i := 0; i < len(queue); i++ {
		id := queue[i]
		if !reachable[id] {
			reachable[id] = true
			queue = append(queue, outgoing[id]...)
		}
	}
	for _, node := range asRecords(ticket["node_instances"]) {
		id := stringValue(node["node_id"])
		if id == targetID {
			node["status"], node["completed_at"], node["blocked_reason"] = "ready", nil, ""
		} else if reachable[id] {
			node["status"], node["values"], node["outputs"] = "pending", record{}, []record{}
			node["completed_at"], node["blocked_reason"] = nil, ""
		}
	}
	ticket["status"], ticket["updated_at"] = "in_progress", now
	state.ticketEvent(ticket, target, "node_rolled_back", fmt.Sprintf("工单已回退到节点「%s」", target["name"]), now)["detail"] = reason
	return ticket, nil
}

func (state *workflowState) reopenTicket(ticketID, now string) (record, error) {
	ticket := findRecord(state.entities["tickets"], ticketID)
	if ticket == nil {
		return nil, failure(404, "工单不存在")
	}
	version := state.ticketVersion(ticket)
	nodes := asRecords(ticket["node_instances"])
	event, title := "ticket_reopened", "工单已重新打开"
	switch {
	case ticket["status"] == "cancelled":
		ticket["status"] = "in_progress"
		for _, node := range nodes {
			if node["status"] == "cancelled" {
				node["status"], node["started_at"], node["completed_at"], node["blocked_reason"] = "pending", nil, nil, ""
			}
		}
		for _, root := range rootInstances(ticket, version) {
			if root["status"] == "pending" {
				root["status"] = "ready"
				definition := findRecord(asRecords(version["nodes"]), stringValue(root["node_id"]))
				hydrateDefaults(ticket, root, definition)
				state.prepareRuntimeResources(ticket, root, definition, now)
				state.executeNodeActions(ticket, root, definition, "on_enter", now)
			}
		}
		state.nodeEnteredActions(ticket, version, state.activateNodes(ticket, version, now, true), now)
		event, title = "ticket_restarted", "工单已重新启动"
	case state.ticketRead(ticket)["status"] == "completed":
		if version == nil {
			return nil, failure(409, "工单绑定版本不存在")
		}
		reopened, err := pickReopenNode(ticket, version)
		if err != nil {
			return nil, err
		}
		definitions := asRecords(version["nodes"])
		for _, node := range nodes {
			if findRecord(definitions, stringValue(node["node_id"]))["node_type"] == "summary" {
				node["status"], node["started_at"], node["completed_at"] = "pending", nil, nil
				node["outputs"], node["blocked_reason"] = []record{}, ""
			}
		}
		reopened["status"], reopened["started_at"], reopened["completed_at"] = "ready", now, nil
		reopened["outputs"], reopened["blocked_reason"] = []record{}, ""
		definition := findRecord(definitions, stringValue(reopened["node_id"]))
		hydrateDefaults(ticket, reopened, definition)
		state.prepareRuntimeResources(ticket, reopened, definition, now)
		state.executeNodeActions(ticket, reopened, definition, "on_enter", now)
	default:
		for _, node := range nodes {
			if node["status"] == "blocked" {
				node["status"], node["blocked_reason"] = "ready", ""
				state.nodeEnteredActions(ticket, version, []record{node}, now)
			}
		}
	}
	ticket["status"], ticket["updated_at"] = "in_progress", now
	state.ticketEvent(ticket, nil, event, title, now)
	state.notifyTicket("ticket_reopened", "工单已重新打开", ticket)
	return ticket, nil
}

func rootInstances(ticket, version record) []record {
	incoming := map[string]bool{}
	for _, edge := range asRecords(version["edges"]) {
		incoming[stringValue(edge["target_node_id"])] = true
	}
	var roots []record
	for _, node := range asRecords(ticket["node_instances"]) {
		id := stringValue(node["node_id"])
		if def := findRecord(asRecords(version["nodes"]), id); def != nil && def["node_type"] != "summary" && !incoming[id] {
			roots = append(roots, node)
		}
	}
	return roots
}

func pickReopenNode(ticket, version record) (record, error) {
	definitions := asRecords(version["nodes"])
	order := map[string]int{}
	completed := map[string]bool{}
	for index, definition := range definitions {
		order[stringValue(definition["id"])] = index
	}
	var actionable []record
	for _, node := range asRecords(ticket["node_instances"]) {
		id := stringValue(node["node_id"])
		if findRecord(definitions, id)["node_type"] != "summary" {
			actionable = append(actionable, node)
			completed[id] = node["status"] == "completed"
		}
	}
	if len(actionable) == 0 {
		return nil, failure(409, "工作流没有可重新执行的普通节点")
	}
	hasCompletedSuccessor := map[string]bool{}
	for _, edge := range asRecords(version["edges"]) {
		if completed[stringValue(edge["target_node_id"])] {
			hasCompletedSuccessor[stringValue(edge["source_node_id"])] = true
		}
	}
	var terminal, fallback []record
	for _, node := range actionable {
		id := stringValue(node["node_id"])
		if completed[id] && !hasCompletedSuccessor[id] {
			terminal = append(terminal, node)
		}
		if completed[id] || node["status"] == "skipped" {
			fallback = append(fallback, node)
		}
	}
	candidates := terminal
	if len(candidates) == 0 {
		candidates = fallback
	}
	if len(candidates) == 0 {
		if roots := rootInstances(ticket, version); len(roots) > 0 {
			return roots[0], nil
		}
		return nil, failure(409, "找不到可重新执行的普通节点")
	}
	slices.SortStableFunc(candidates, func(a, b record) int {
		if cmp := scheduleTimestamp(b["completed_at"]).Compare(scheduleTimestamp(a["completed_at"])); cmp != 0 {
			return cmp
		}
		return order[stringValue(b["node_id"])] - order[stringValue(a["node_id"])]
	})
	reopened := candidates[0]
	if findRecord(definitions, stringValue(reopened["node_id"])) == nil {
		return nil, failure(409, "工单节点定义不存在")
	}
	return reopened, nil
}
