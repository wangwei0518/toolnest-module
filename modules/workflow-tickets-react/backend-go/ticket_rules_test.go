package main

import (
	"slices"
	"testing"
)

func TestValidateValuesSkipsFormatChecksForReadOnlyOutput(t *testing.T) {
	fields := []record{
		{"id": "compose", "label": "docker compose", "type": "json", "required": true, "readonly": true},
		{"id": "reference", "label": "引用结果", "type": "json", "reference": record{"path": "nodes.prepare.values.compose"}},
		{"id": "input", "label": "手填配置", "type": "json", "required": true},
	}
	const yaml = "services:\n  app:\n    image: nginx"
	values := record{"compose": yaml, "reference": yaml, "input": yaml}
	for _, completing := range []bool{false, true} {
		if got := validateValues(fields, values, completing); !slices.Equal(got, []string{"「手填配置」不是有效 JSON"}) {
			t.Errorf("completing = %v: got %v, expected only the editable field's format error", completing, got)
		}
	}
	values["input"] = "{}"
	if got := validateValues(fields, values, true); len(got) != 0 {
		t.Errorf("completing with populated read-only output: got %v", got)
	}
	delete(values, "compose")
	if got := validateValues(fields, values, true); !slices.Equal(got, []string{"「docker compose」为必填项"}) {
		t.Errorf("completing without required output: got %v", got)
	}
}

func TestCompletionRulesFromDesigner(t *testing.T) {
	state := newState()
	node := record{"id": "current-instance", "values": record{"result": "通过", "score": 8}}
	ticket := record{"node_instances": []record{{"node_id": "prepare", "status": "completed"}}}
	state.entities["attachments"] = []record{
		{"ticket_node_id": "current-instance", "field_id": "photo"},
		{"ticket_node_id": "other-instance", "field_id": "photo"},
	}
	tests := []struct {
		name string
		rule record
		want bool
	}{
		{"designer equality", record{"kind": "value_compare", "field_id": "result", "operator_value": "=", "value": "通过"}, true},
		{"designer equality mismatch", record{"kind": "value_compare", "field_id": "result", "operator_value": "=", "value": "拒绝"}, false},
		{"designer number comparison", record{"kind": "value_compare", "field_id": "score", "operator_value": ">", "value": "7"}, true},
		{"legacy comparison operand", record{"kind": "value_compare", "field_id": "result", "operator": "==", "operator_value": "通过"}, true},
		{"legacy comparison alias", record{"kind": "value_compare", "field_id": "score", "operator": "greater_than", "value": 9}, false},
		{"designer attachment count", record{"kind": "attachment_count", "field_id": "photo", "value": 2}, false},
		{"legacy attachment count", record{"kind": "attachment_count", "field_id": "photo", "count": 1}, true},
		{"designer node status", record{"kind": "node_status", "field_id": "prepare", "value": "completed"}, true},
		{"legacy node status", record{"kind": "node_status", "node_id": "prepare", "statuses": []any{"blocked"}}, false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := state.evaluateRule(test.rule, ticket, node); got != test.want {
				t.Errorf("got %v, want %v", got, test.want)
			}
		})
	}
}
