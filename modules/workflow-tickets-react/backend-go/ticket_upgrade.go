package main

import (
	"fmt"
	"maps"
	"reflect"
)

func (state *workflowState) upgradeTicketWorkflow(ticket, body record, actor, now string) (record, error) {
	workflow, err := state.workflow(stringValue(ticket["workflow_id"]))
	if err != nil {
		return nil, err
	}
	from := state.ticketVersion(ticket)
	latest := publishedVersion(workflow)
	if from == nil || latest == nil {
		return nil, failure(409, "缺少工单当前版本或已发布的目标版本")
	}
	if requested := stringValue(body["target_version_id"]); requested == "" || requested != latest["id"] {
		return nil, failure(409, "最新模板版本已变化，请刷新工单后重试")
	}
	if from["id"] == latest["id"] {
		return ticket, nil
	}
	if body["source_version_id"] != from["id"] || numeric(latest["version"]) <= numeric(from["version"]) {
		return nil, failure(409, "工单当前模板版本已变化，请刷新后重试")
	}
	latestNodes, latestEdges := asRecords(latest["nodes"]), asRecords(latest["edges"])
	if err := validateGraph(latestNodes, latestEdges); err != nil {
		return nil, err
	}

	saved := make(map[string]record)
	for _, node := range asRecords(ticket["node_instances"]) {
		id := stringValue(node["node_id"])
		if id == "" || saved[id] != nil {
			return nil, failure(409, "工单节点标识不完整，无法安全升级")
		}
		saved[id] = node
	}
	attachments := matchingRecords(state.entities["attachments"], "ticket_id", ticket["id"])
	resources := matchingRecords(state.entities["temporary_resources"], "ticket_id", ticket["id"])
	history := matchingRecords(state.entities["timeline"], "ticket_id", ticket["id"])
	for id, previous := range saved {
		def := findRecord(latestNodes, id)
		if def == nil {
			if nodeHasProgress(previous, attachments, resources) || len(matchingRecords(history, "node_id", id)) > 0 {
				return nil, failure(409, fmt.Sprintf("新版移除了已有进度的节点「%s」，请在模板中保留该节点后再升级", previous["name"]))
			}
			continue
		}
		oldDef := findRecord(asRecords(from["nodes"]), id)
		oldType := stringOr(oldDef["node_type"], stringOr(previous["node_type"], "general"))
		if oldType != stringOr(def["node_type"], "general") && nodeHasProgress(previous, attachments, resources) {
			return nil, failure(409, fmt.Sprintf("新版更改了已有进度的节点「%s」的类型，无法安全升级", previous["name"]))
		}
		if label := removedSavedField(previous, oldDef, def, attachments, resources); label != "" {
			return nil, failure(409, fmt.Sprintf("新版移除了节点「%s」中有保存内容的字段「%s」，请保留该字段后再升级", previous["name"], label))
		}
	}

	upgraded := maps.Clone(ticket)
	instances := make([]record, 0, len(latestNodes))
	for _, definition := range latestNodes {
		previous := saved[stringValue(definition["id"])]
		if previous == nil {
			node := newTicketNode(definition)
			switch ticket["status"] {
			case "cancelled":
				node["status"] = "cancelled"
			case "completed", "archived":
				node["status"] = "skipped"
			}
			instances = append(instances, node)
			continue
		}
		node := maps.Clone(previous)
		node["values"] = maps.Clone(objectOrEmpty(previous["values"]))
		node["resources"] = maps.Clone(objectOrEmpty(previous["resources"]))
		node["name"], node["key"], node["node_type"] = definition["name"], definition["key"], stringOr(definition["node_type"], "general")
		instances = append(instances, node)
	}
	upgraded["node_instances"], upgraded["workflow_version_id"] = instances, latest["id"]
	upgraded["workflow_name"], upgraded["updated_at"] = workflow["name"], now
	if !terminalTicket(ticket["status"]) {
		for _, node := range rootInstances(upgraded, latest) {
			def := findRecord(latestNodes, stringValue(node["node_id"]))
			if node["status"] == "pending" && predecessorsSatisfied(upgraded, asRecord(def["predecessor_rule"])) {
				node["status"] = "ready"
				hydrateDefaults(upgraded, node, def)
				if len(asRecord(node["resources"])) == 0 {
					state.prepareRuntimeResources(upgraded, node, def, now)
				}
			}
		}
		state.activateConnectedNodes(upgraded, latest, now, false, false)
		if allActionableFinished(upgraded, latest) {
			upgraded["status"] = "completed"
			finishSummary(upgraded, latest, now)
		} else if !hasRunnableNode(instances) {
			return nil, failure(409, "升级后没有可继续处理的节点，请检查新版模板的前序条件和连线")
		}
	}
	if ticket["status"] == "completed" {
		for _, node := range instances {
			if node["node_type"] == "summary" && saved[stringValue(node["node_id"])] == nil {
				def := findRecord(latestNodes, stringValue(node["node_id"]))
				hydrateDefaults(upgraded, node, def)
				node["status"], node["completed_at"] = "completed", now
			}
		}
	}
	if ticket["status"] != "cancelled" && ticket["status"] != "archived" {
		oldNodes := asRecords(from["nodes"])
		for _, node := range instances {
			id := stringValue(node["node_id"])
			previous := saved[id]
			if previous != nil {
				state.refreshUpgradedScripts(upgraded, node, previous, findRecord(oldNodes, id), findRecord(latestNodes, id), now)
			}
		}
	}
	maps.Copy(ticket, upgraded)
	event := state.ticketEvent(ticket, nil, "ticket_workflow_upgraded", "工单模板已升级", now)
	event["detail"] = fmt.Sprintf("V%s → V%s", stringValue(from["version"]), stringValue(latest["version"]))
	event["actor_name"] = actor
	return ticket, nil
}

func (state *workflowState) refreshUpgradedScripts(ticket, node, previous, from, to record, now string) {
	oldFields := asRecords(asRecord(from["form_schema"])["fields"])
	for _, field := range asRecords(asRecord(to["form_schema"])["fields"]) {
		id := stringValue(field["id"])
		before := findRecord(oldFields, id)
		oldScript, newScript := before["type"] == "script", field["type"] == "script"
		if !oldScript && !newScript {
			continue
		}
		oldConfig, newConfig := asRecord(before["config"]), asRecord(field["config"])
		if oldScript == newScript && reflect.DeepEqual(oldConfig, newConfig) {
			continue
		}
		hadResource := asRecord(previous["resources"])[id] != nil
		if !newScript || stringValue(newConfig["execution_template"]) == "" {
			state.revokeRuntimeResource(ticket, node, field)
			delete(asRecord(node["resources"]), id)
			continue
		}
		if hadResource || hasRunnableNode([]record{previous}) {
			hydrateDefaults(ticket, node, to)
			state.prepareRuntimeResource(ticket, node, field, now)
		}
	}
}

func hasRunnableNode(instances []record) bool {
	for _, node := range instances {
		switch node["status"] {
		case "ready", "in_progress", "waiting", "blocked":
			return true
		}
	}
	return false
}

func removedSavedField(node, from, to record, attachments, resources []record) string {
	oldFields := asRecords(asRecord(from["form_schema"])["fields"])
	newFields := asRecords(asRecord(to["form_schema"])["fields"])
	for _, field := range oldFields {
		id := stringValue(field["id"])
		if findRecord(newFields, id) != nil {
			continue
		}
		if hasValue(asRecord(node["values"])[id]) || asRecord(node["resources"])[id] != nil {
			return stringOr(field["label"], id)
		}
		for _, records := range [][]record{attachments, resources} {
			for _, item := range records {
				if item["ticket_node_id"] == node["id"] && item["field_id"] == id {
					return stringOr(field["label"], id)
				}
			}
		}
	}
	return ""
}

func nodeHasProgress(node record, attachments, resources []record) bool {
	if node["status"] != "pending" || node["started_at"] != nil || node["completed_at"] != nil ||
		len(asRecord(node["values"])) > 0 || len(asRecords(node["outputs"])) > 0 || len(asRecord(node["resources"])) > 0 ||
		hasValue(node["assignee_id"]) || hasValue(node["assignee_name"]) || hasValue(node["blocked_reason"]) {
		return true
	}
	for _, item := range attachments {
		if item["ticket_node_id"] == node["id"] {
			return true
		}
	}
	for _, item := range resources {
		if item["ticket_node_id"] == node["id"] {
			return true
		}
	}
	return false
}
