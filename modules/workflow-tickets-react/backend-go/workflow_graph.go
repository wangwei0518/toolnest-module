package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
)

type domainError struct {
	status  int
	message string
}

func (err *domainError) Error() string { return err.message }

func invalidGraph(message string, args ...any) error {
	return &domainError{status: 422, message: fmt.Sprintf(message, args...)}
}

func newID() string {
	var bytes [16]byte
	rand.Read(bytes[:])
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	return hex.EncodeToString(bytes[:])
}

func asRecord(value any) record {
	switch value := value.(type) {
	case record:
		return value
	case map[string]any:
		return record(value)
	default:
		return nil
	}
}

func asRecords(value any) []record {
	switch value := value.(type) {
	case []record:
		return value
	case []any:
		objects := make([]record, 0, len(value))
		for _, item := range value {
			objects = append(objects, asRecord(item))
		}
		return objects
	default:
		return nil
	}
}

func stringValue(value any) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func validateGraph(nodes, edges []record) error {
	nodesByID := make(map[string]record, len(nodes))
	indegree := make(map[string]int, len(nodes))
	summaries := 0
	for _, node := range nodes {
		id := stringValue(node["id"])
		if id == "" {
			return invalidGraph("节点标识不能为空")
		}
		if _, found := nodesByID[id]; found {
			return invalidGraph("工作流包含重复的节点标识")
		}
		nodesByID[id] = node
		indegree[id] = 0
		if node["node_type"] == "summary" {
			summaries++
		}
	}
	if summaries > 1 {
		return invalidGraph("一个工作流只能配置一个总结节点")
	}

	links := make(map[[2]string]struct{}, len(edges))
	outgoing := make(map[string][]string, len(nodes))
	for _, edge := range edges {
		from, to := stringValue(edge["source_node_id"]), stringValue(edge["target_node_id"])
		if nodesByID[from] == nil || nodesByID[to] == nil {
			return invalidGraph("连线引用了不存在的节点")
		}
		if from == to {
			return invalidGraph("节点不能连接到自身")
		}
		if nodesByID[from]["node_type"] == "summary" {
			return invalidGraph("总结节点只能作为工单完成后的展示节点，不能连接后续节点")
		}
		key := [2]string{from, to}
		if _, exists := links[key]; exists {
			return invalidGraph("相同节点之间不能重复连线")
		}
		links[key] = struct{}{}
		outgoing[from] = append(outgoing[from], to)
		indegree[to]++
	}

	ready := make([]string, 0, len(nodes))
	for node, count := range indegree {
		if count == 0 {
			ready = append(ready, node)
		}
	}
	for i := 0; i < len(ready); i++ {
		for _, target := range outgoing[ready[i]] {
			indegree[target]--
			if indegree[target] == 0 {
				ready = append(ready, target)
			}
		}
	}
	if len(ready) != len(nodes) {
		return invalidGraph("工作流不能形成循环连线")
	}

	for _, node := range nodes {
		if node["predecessor_rule"] == nil {
			continue
		}
		rule := asRecord(node["predecessor_rule"])
		op, conditions := rule["operator"], asRecords(rule["conditions"])
		name := stringValue(node["name"])
		if (op != "AND" && op != "OR") || len(conditions) == 0 {
			return invalidGraph("节点「%s」的前序配置无效", name)
		}
		for _, condition := range conditions {
			link := [2]string{stringValue(condition["node_id"]), stringValue(node["id"])}
			if _, exists := links[link]; !exists {
				return invalidGraph("节点「%s」的前序配置引用了未连接的节点", name)
			}
		}
	}
	return nil
}
