package main

import (
	"errors"
	"strings"
	"testing"
)

func TestValidateGraph(t *testing.T) {
	start := record{"id": "first", "name": "准备"}
	finish := record{"id": "second", "name": "执行"}
	summary := record{"id": "summary", "node_type": "summary"}
	edge := func(from, to string) record {
		return record{"source_node_id": from, "target_node_id": to}
	}
	for _, test := range []struct {
		name         string
		nodes, edges []record
		want         string
	}{
		{"valid summary", []record{start, finish, summary}, []record{edge("first", "second"), edge("second", "summary")}, ""},
		{"duplicate node", []record{start, start}, nil, "重复的节点"},
		{"duplicate edge", []record{start, finish}, []record{edge("first", "second"), edge("first", "second")}, "重复连线"},
		{"cycle", []record{start, finish}, []record{edge("first", "second"), edge("second", "first")}, "循环连线"},
		{"summary successor", []record{start, summary}, []record{edge("summary", "first")}, "不能连接后续节点"},
		{"unknown node", []record{start}, []record{edge("first", "missing")}, "不存在的节点"},
		{"disconnected predecessor", []record{start, {
			"id": "second", "name": "执行", "predecessor_rule": record{
				"operator": "AND", "conditions": []record{{"node_id": "first"}},
			},
		}}, nil, "引用了未连接的节点"},
	} {
		t.Run(test.name, func(t *testing.T) {
			err := validateGraph(test.nodes, test.edges)
			if test.want == "" {
				if err != nil {
					t.Fatal(err)
				}
				return
			}
			var invalid *domainError
			if !errors.As(err, &invalid) || invalid.status != 422 || !strings.Contains(invalid.message, test.want) {
				t.Errorf("validateGraph returned %v, want 422 containing %q", err, test.want)
			}
		})
	}
}
