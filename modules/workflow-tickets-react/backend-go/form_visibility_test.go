package main

import (
	"strings"
	"testing"
)

func visibilityComparison(node, field, operator string, value any) record {
	return record{"type": "rule", "kind": "value_compare", "node_id": node, "field_id": field, "operator_value": operator, "value": value}
}

func TestConditionalFieldsSaveCompleteAndRender(t *testing.T) {
	state := newState()
	const now = "2026-11-25T08:00:00Z"
	first := record{"id": "first", "name": "申请", "key": "request", "form_schema": record{"fields": []record{
		{"id": "approval", "type": "switch"},
		{"id": "count", "type": "number"},
		{"id": "details", "type": "json", "label": "审批资料", "required": true, "visibility_rule": visibilityComparison("", "approval", "=", true)},
		{"id": "file", "type": "file", "label": "文件", "required": true, "visibility_rule": visibilityComparison("", "approval", "=", true)},
		{"id": "dependent", "visibility_rule": visibilityComparison("", "details", "!=", "empty")},
		{"id": "zero", "visibility_rule": visibilityComparison("", "count", "=", 0)},
	}}, "completion_rule": record{"type": "group", "operator": "OR", "children": []record{
		{"kind": "field_filled", "field_id": "details"},
		{"kind": "attachment_count", "field_id": "file"},
	}}}
	second := record{"id": "second", "name": "执行", "form_schema": record{"fields": []record{
		{"id": "unneeded", "visibility_rule": visibilityComparison("first", "details", "!=", "empty"), "required": true},
		{"id": "needed", "visibility_rule": visibilityComparison("first", "approval", "=", false)},
		{"id": "reference", "reference": record{"path": "nodes.request.values.details"}},
		{"id": "script", "type": "script", "config": record{"execution_template": "visible=[{{ nodes.request.values.details }}]"}},
	}}}
	edges := []record{{"source_node_id": "first", "target_node_id": "second"}}
	version := record{"id": "version", "status": "published", "nodes": []record{first, second}, "edges": edges}
	workflow := record{"id": "workflow", "versions": []record{version}}
	state.entities["workflows"] = []record{workflow}
	if err := validateVisibilityRules(asRecords(version["nodes"]), edges); err != nil {
		t.Fatal(err)
	}
	ticket, err := state.createTicketFromVersion(workflow, version, record{"title": "测试"}, "tester", now)
	if err != nil {
		t.Fatal(err)
	}
	id := stringValue(ticket["id"])
	node := nodeByDefinition(ticket, "first")
	if _, err := state.saveNode(id, "first", record{"approval": true, "details": "invalid JSON"}, now); err == nil {
		t.Fatal("visible JSON field should be checked")
	}
	if _, err := state.saveNode(id, "first", record{"approval": false, "details": "draft", "count": 0}, now); err != nil {
		t.Fatal(err)
	}
	if _, err := state.saveNode(id, "first", record{"approval": false, "count": 0}, now); err != nil {
		t.Fatal(err)
	}
	state.entities["attachments"] = []record{{"ticket_node_id": node["id"], "field_id": "file"}}
	hidden := conditionalHiddenFields(ticket, version, node, asRecord(node["values"]))
	if !hidden["details"] || !hidden["dependent"] || hidden["zero"] {
		t.Fatalf("unexpected visibility: %v", hidden)
	}
	if _, err := state.completeNode(id, "first", now); err != nil {
		t.Fatal(err)
	}
	if asRecord(node["values"])["details"] != "draft" || asRecord(asRecords(node["outputs"])[0]["value"])["details"] != nil || len(state.entities["attachments"]) != 1 {
		t.Fatal("the hidden field should remain a draft without entering the result")
	}
	next := nodeByDefinition(ticket, "second")
	nextValues := asRecord(next["values"])
	nextHidden := conditionalHiddenFields(ticket, version, next, nextValues)
	if !nextHidden["unneeded"] || nextHidden["needed"] || nextValues["reference"] != nil {
		t.Fatalf("unexpected upstream visibility or reference: %v, %v", nextHidden, nextValues)
	}
	if content := asRecord(asRecord(next["resources"])["script"])["content"]; content != "visible=[]" {
		t.Fatalf("script received hidden data: %v", content)
	}
}

func TestPublishRejectsInvalidVisibilityReferences(t *testing.T) {
	for _, scenario := range []struct {
		name string
		rule record
		want string
	}{
		{"self", visibilityComparison("", "a", "=", true), "循环"},
		{"missing field", visibilityComparison("", "deleted", "!=", true), "不存在"},
		{"downstream", visibilityComparison("after", "b", "=", true), "上游"},
		{"empty group", record{"type": "group", "operator": "AND", "children": []record{}}, "至少一个条件"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			node := record{"id": "before", "form_schema": record{"fields": []record{{"id": "a", "visibility_rule": scenario.rule}}}}
			other := record{"id": "after", "form_schema": record{"fields": []record{{"id": "b"}}}}
			version := record{"id": "draft", "status": "draft", "nodes": []record{node, other}, "edges": []record{{"source_node_id": "before", "target_node_id": "after"}}}
			workflow := record{"id": "workflow", "versions": []record{version}}
			_, err := newState().publishWorkflow(workflow, record{"version_id": "draft"}, "2026-11-25T08:00:00Z")
			if err == nil || !strings.Contains(err.Error(), scenario.want) || version["status"] != "draft" {
				t.Fatalf("publish: %v, status %v", err, version["status"])
			}
		})
	}
}

func TestConditionalRoutingSkipsUnreachableAndReevaluatesAfterRollback(t *testing.T) {
	state := newState()
	const now = "2026-11-25T08:00:00Z"
	condition := visibilityComparison("", "approval", "=", true)
	inverse := visibilityComparison("", "approval", "=", true)
	inverse["negate"] = true // Earlier designer format.
	version := record{
		"id": "version", "status": "published",
		"nodes": []record{
			{"id": "first", "form_schema": record{"fields": []record{{"id": "approval", "type": "switch"}}}},
			{"id": "join"}, {"id": "descendant"}, {"id": "yes"}, {"id": "no"}, {"id": "parallel"},
			{"id": "summary", "node_type": "summary"},
		},
		"edges": []record{
			{"source_node_id": "first", "target_node_id": "yes", "condition_mode": "conditional", "condition": condition},
			{"source_node_id": "first", "target_node_id": "no", "condition_mode": "unless", "condition": inverse},
			{"source_node_id": "first", "target_node_id": "parallel"},
			{"source_node_id": "no", "target_node_id": "descendant"},
			{"source_node_id": "yes", "target_node_id": "join"},
			{"source_node_id": "descendant", "target_node_id": "join"},
		},
	}
	workflow := record{"id": "workflow", "versions": []record{version}}
	state.entities["workflows"] = []record{workflow}
	ticket, err := state.createTicketFromVersion(workflow, version, record{"title": "测试"}, "tester", now)
	if err != nil {
		t.Fatal(err)
	}
	id := stringValue(ticket["id"])
	status := func(node string, want string) {
		t.Helper()
		if got := nodeByDefinition(ticket, node)["status"]; got != want {
			t.Fatalf("%s: got %v, want %s", node, got, want)
		}
	}
	complete := func(node string) {
		t.Helper()
		if _, err := state.completeNode(id, node, now); err != nil {
			t.Fatal(err)
		}
	}
	save := func(value bool) {
		t.Helper()
		if _, err := state.saveNode(id, "first", record{"approval": value}, now); err != nil {
			t.Fatal(err)
		}
	}
	save(true)
	complete("first")
	status("yes", "ready")
	status("no", "skipped")
	status("descendant", "skipped")
	status("join", "pending")
	complete("parallel")
	if _, err := state.rollbackNode(id, "yes", "first", "改走另一支", now); err != nil {
		t.Fatal(err)
	}
	status("no", "pending")
	status("parallel", "completed")
	save(false)
	complete("first")
	status("yes", "skipped")
	status("no", "ready")
	status("join", "pending")
	complete("no")
	complete("descendant")
	complete("join")
	status("summary", "completed")
	if ticket["status"] != "completed" {
		t.Fatalf("ticket should finish: %v", ticket["status"])
	}
}

func TestWorkflowUpgradeRefreshesScriptWhenUpstreamFieldBecomesHidden(t *testing.T) {
	state := newState()
	const now = "2026-11-25T08:00:00Z"
	before := record{"id": "first", "name": "申请", "key": "request", "form_schema": record{"fields": []record{
		{"id": "approval", "type": "switch"},
		{"id": "details", "type": "text"},
	}}}
	after := record{"id": "first", "name": "申请", "key": "request", "form_schema": record{"fields": []record{
		{"id": "approval", "type": "switch"},
		{"id": "details", "type": "text", "visibility_rule": visibilityComparison("", "approval", "=", true)},
	}}}
	second := record{"id": "second", "form_schema": record{"fields": []record{
		{"id": "script", "type": "script", "config": record{"execution_template": "[{{ nodes.request.values.details }}]"}},
	}}}
	edges := []record{{"source_node_id": "first", "target_node_id": "second"}}
	old := record{"id": "v1", "version": 1, "status": "archived", "nodes": []record{before, second}, "edges": edges}
	latest := record{"id": "v2", "version": 2, "status": "published", "nodes": []record{after, second}, "edges": edges}
	workflow := record{"id": "workflow", "versions": []record{old, latest}}
	state.entities["workflows"] = []record{workflow}
	ticket, err := state.createTicketFromVersion(workflow, old, record{
		"title": "测试", "initial_values": record{"approval": false, "details": "旧模板有值"},
	}, "tester", now)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := state.completeNode(stringValue(ticket["id"]), "first", now); err != nil {
		t.Fatal(err)
	}
	oldResource := state.entities["temporary_resources"][0]
	if oldResource["content"] != "[旧模板有值]" {
		t.Fatalf("unexpected initial script: %v", oldResource["content"])
	}
	if _, err := state.upgradeTicketWorkflow(ticket, record{"source_version_id": "v1", "target_version_id": "v2"}, "tester", now); err != nil {
		t.Fatal(err)
	}
	first, next := nodeByDefinition(ticket, "first"), nodeByDefinition(ticket, "second")
	if first["status"] != "completed" || asRecord(first["values"])["details"] != "旧模板有值" || next["status"] != "ready" {
		t.Fatal("upgrade should preserve progress and draft data")
	}
	resource := asRecord(asRecord(next["resources"])["script"])
	if resource["content"] != "[]" || !truthy(oldResource["revoked"]) {
		t.Fatalf("upgrade retained a script with hidden data: %v", resource["content"])
	}
}
