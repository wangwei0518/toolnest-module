package main

import "testing"

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
