package main

import (
	"errors"
	"maps"
	"testing"
)

func workflowUpgradeFixture() (*workflowState, record, record) {
	state := newState()
	first := record{"id": "prepare", "name": "准备", "form_schema": record{"fields": []record{{"id": "note", "label": "记录"}}}}
	second := record{"id": "work", "name": "执行"}
	old := record{"id": "v1", "version": 1, "status": "archived", "nodes": []record{first, second}}
	latest := record{
		"id": "v2", "version": 2, "status": "published",
		"nodes": []record{first, second, {"id": "verify", "name": "复核"}},
		"edges": []record{
			{"source_node_id": "prepare", "target_node_id": "work"},
			{"source_node_id": "work", "target_node_id": "verify"},
		},
	}
	workflow := record{"id": "workflow", "name": "升级模板", "versions": []record{old, latest, {"id": "v3", "version": 3, "status": "draft"}}}
	state.entities["workflows"] = []record{workflow}
	ticket := record{"id": "ticket", "workflow_id": "workflow", "workflow_version_id": "v1", "status": "in_progress",
		"node_instances": []record{
			{"id": "first", "node_id": "prepare", "name": "准备", "status": "completed", "values": record{"note": "保留记录"}, "completed_at": "2026-11-24T00:00:00.000Z",
				"outputs": []record{{"key": "result", "value": "保留输出"}}, "resources": record{"script": record{"id": "resource"}}},
			{"id": "second", "node_id": "work", "name": "执行", "status": "in_progress", "assignee_id": "user"},
		},
	}
	state.entities["tickets"] = []record{ticket}
	state.entities["attachments"] = []record{{"id": "file", "ticket_id": "ticket", "ticket_node_id": "first", "field_id": "note"}}
	return state, ticket, latest
}

func TestUpgradeWorkflowPreservesProgress(t *testing.T) {
	state, ticket, _ := workflowUpgradeFixture()
	request := record{"source_version_id": "v1", "target_version_id": "v2"}
	const now = "2026-11-24T01:00:00.000Z"
	result, err := state.upgradeTicketWorkflow(ticket, request, "处理人", now)
	if err != nil {
		t.Fatal(err)
	}
	nodes := asRecords(result["node_instances"])
	if result["workflow_version_id"] != "v2" || result["status"] != "in_progress" || len(nodes) != 3 {
		t.Fatalf("unexpected upgraded ticket: %v", result)
	}
	if nodes[0]["id"] != "first" || nodes[0]["status"] != "completed" || nodes[0]["completed_at"] != "2026-11-24T00:00:00.000Z" ||
		asRecord(nodes[0]["values"])["note"] != "保留记录" || asRecords(nodes[0]["outputs"])[0]["value"] != "保留输出" ||
		asRecord(asRecord(nodes[0]["resources"])["script"])["id"] != "resource" || state.entities["attachments"][0]["ticket_node_id"] != "first" {
		t.Fatalf("history changed: %v", nodes[0])
	}
	if nodes[1]["id"] != "second" || nodes[1]["status"] != "in_progress" || nodes[1]["assignee_id"] != "user" ||
		nodes[2]["status"] != "pending" {
		t.Fatalf("unexpected active or new node: %v", nodes)
	}
	if _, err := state.upgradeTicketWorkflow(ticket, request, "处理人", now); err != nil {
		t.Fatal(err)
	}
	if entries := state.entities["timeline"]; len(entries) != 1 || entries[0]["type"] != "ticket_workflow_upgraded" || entries[0]["actor_name"] != "处理人" {
		t.Fatalf("unexpected upgrade history: %v", entries)
	}
}

func TestUpgradeWorkflowProtectsHistoricalData(t *testing.T) {
	for _, scenario := range []string{"removed node", "removed field", "unpublished target"} {
		t.Run(scenario, func(t *testing.T) {
			state, ticket, latest := workflowUpgradeFixture()
			request := record{"source_version_id": "v1", "target_version_id": "v2"}
			switch scenario {
			case "removed node":
				latest["nodes"] = asRecords(latest["nodes"])[1:]
				latest["edges"] = asRecords(latest["edges"])[1:]
			case "removed field":
				list := asRecords(latest["nodes"])
				list[0] = record{"id": "prepare", "name": "准备"}
			case "unpublished target":
				request["target_version_id"] = "v3"
			}
			_, err := state.upgradeTicketWorkflow(ticket, request, "处理人", "2026-11-24T01:00:00.000Z")
			var conflict *domainError
			if !errors.As(err, &conflict) || conflict.status != 409 || ticket["workflow_version_id"] != "v1" ||
				len(asRecords(ticket["node_instances"])) != 2 || len(state.entities["timeline"]) != 0 {
				t.Fatalf("upgrade should reject without mutation: %v, %v", err, ticket)
			}
		})
	}
}

func TestUpgradeWorkflowKeepsCompletedTicketClosed(t *testing.T) {
	state, ticket, _ := workflowUpgradeFixture()
	ticket["status"] = "completed"
	asRecords(ticket["node_instances"])[1]["status"] = "completed"
	result, err := state.upgradeTicketWorkflow(ticket, record{"source_version_id": "v1", "target_version_id": "v2"}, "处理人", "2026-11-24T01:00:00.000Z")
	if err != nil {
		t.Fatal(err)
	}
	if result["status"] != "completed" || asRecords(result["node_instances"])[2]["status"] != "skipped" {
		t.Fatalf("closed ticket was restarted: %v", result)
	}
}

func TestUpgradeWorkflowEnablesNewNodeAfterCompletedPredecessor(t *testing.T) {
	state, ticket, latest := workflowUpgradeFixture()
	asRecords(latest["edges"])[1]["source_node_id"] = "prepare"
	verify := asRecords(latest["nodes"])[2]
	verify["form_schema"] = record{"fields": []record{{"id": "note", "default": "新增节点的默认值"}}}
	result, err := state.upgradeTicketWorkflow(ticket, record{"source_version_id": "v1", "target_version_id": "v2"}, "处理人", "2026-11-24T01:00:00.000Z")
	if err != nil {
		t.Fatal(err)
	}
	node := asRecords(result["node_instances"])[2]
	if node["status"] != "ready" || asRecord(node["values"])["note"] != "新增节点的默认值" {
		t.Fatalf("new successor did not become ready: %v", node)
	}
	if len(state.entities["timeline"]) != 1 || len(state.entities["action_executions"]) != 0 {
		t.Fatal("upgrade replayed workflow actions")
	}
}

func TestUpgradeWorkflowRefreshesChangedScript(t *testing.T) {
	state, ticket, latest := workflowUpgradeFixture()
	from := state.ticketVersion(ticket)
	script := func(template string) record {
		return record{"id": "deploy", "type": "script", "config": record{"execution_template": template}}
	}
	unchanged := script("unchanged")
	unchanged["id"] = "unchanged"
	oldNode := maps.Clone(asRecords(from["nodes"])[1])
	newNode := maps.Clone(asRecords(latest["nodes"])[1])
	oldNode["form_schema"] = record{"fields": []record{script("old"), unchanged}}
	newNode["form_schema"] = record{"fields": []record{script("new: {{ nodes.prepare.values.note }}"), unchanged}}
	asRecords(from["nodes"])[1] = oldNode
	asRecords(latest["nodes"])[1] = newNode
	asRecords(ticket["node_instances"])[0]["key"] = "prepare"
	asRecords(latest["nodes"])[0]["key"] = "prepare"
	node := asRecords(ticket["node_instances"])[1]
	node["values"] = record{"draft": "保留草稿"}
	const now = "2026-11-24T01:00:00.000Z"
	state.prepareRuntimeResources(ticket, node, oldNode, now)
	old := state.entities["temporary_resources"][0]
	same := state.entities["temporary_resources"][1]
	result, err := state.upgradeTicketWorkflow(ticket, record{"source_version_id": "v1", "target_version_id": "v2"}, "处理人", now)
	if err != nil {
		t.Fatal(err)
	}
	updated := asRecords(result["node_instances"])[1]
	resources := asRecord(updated["resources"])
	if generated := asRecord(resources["deploy"]); generated["content"] != "new: 保留记录" ||
		generated["id"] == old["id"] || old["revoked"] != true {
		t.Fatalf("changed script was not regenerated, or old token was not revoked")
	}
	if asRecord(resources["unchanged"])["id"] != same["id"] || same["revoked"] != false ||
		updated["status"] != "in_progress" || asRecord(updated["values"])["draft"] != "保留草稿" {
		t.Fatal("unchanged script or saved progress was modified")
	}
}
