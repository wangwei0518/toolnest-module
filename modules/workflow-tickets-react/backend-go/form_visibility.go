package main

import (
	"encoding/json"
	"maps"
	"math"
	"regexp"
)

var decimalVisibilityOperand = regexp.MustCompile(`(?i)^[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:e[+-]?[0-9]+)?$`)

func visibilityNumber(value any) float64 {
	if _, boolean := value.(bool); !boolean && !decimalVisibilityOperand.MatchString(stringValue(value)) {
		return math.NaN()
	}
	return numeric(value)
}

func validateVisibilityRules(nodes, edges []record) error {
	incoming := map[string][]string{}
	for _, edge := range edges {
		to := stringValue(edge["target_node_id"])
		incoming[to] = append(incoming[to], stringValue(edge["source_node_id"]))
	}
	for _, node := range nodes {
		nodeID := stringValue(node["id"])
		upstream := map[string]bool{}
		queue := append([]string(nil), incoming[nodeID]...)
		for i := 0; i < len(queue); i++ {
			id := queue[i]
			if !upstream[id] {
				upstream[id] = true
				queue = append(queue, incoming[id]...)
			}
		}
		fields := formFields(node)
		visiting, checked := map[string]bool{}, map[string]bool{}
		var validateField func(record) error
		validateField = func(field record) error {
			id := stringValue(field["id"])
			if visiting[id] {
				return invalidGraph("节点「%s」的字段「%s」存在循环显示条件", node["name"], field["label"])
			}
			if checked[id] || field["visibility_rule"] == nil {
				return nil
			}
			visiting[id] = true
			err := validateVisibilityRule(asRecord(field["visibility_rule"]), func(sourceID, fieldID string) error {
				if sourceID == "" || sourceID == nodeID {
					source := findRecord(fields, fieldID)
					if source == nil || fieldID == "" {
						return invalidGraph("引用了不存在的字段")
					}
					return validateField(source)
				}
				source := findRecord(nodes, sourceID)
				if !upstream[sourceID] || source["node_type"] == "summary" || fieldID == "" || findRecord(formFields(source), fieldID) == nil {
					return invalidGraph("只能引用本节点或有效的上游节点字段")
				}
				return nil
			})
			if err != nil {
				return invalidGraph("节点「%s」的字段「%s」的显示条件无效：%s", node["name"], field["label"], err)
			}
			delete(visiting, id)
			checked[id] = true
			return nil
		}
		for _, field := range fields {
			if err := validateField(field); err != nil {
				return err
			}
		}
	}
	return nil
}

func validateVisibilityRule(rule record, validateSource func(string, string) error) error {
	switch rule["type"] {
	case "group":
		children := asRecords(rule["children"])
		if len(children) == 0 || (rule["operator"] != "AND" && rule["operator"] != "OR") {
			return invalidGraph("请添加至少一个条件，并选择有效的组合方式")
		}
		for _, child := range children {
			if err := validateVisibilityRule(child, validateSource); err != nil {
				return err
			}
		}
	case "rule":
		switch rule["kind"] {
		case "field_filled":
		case "value_compare":
			switch rule["operator_value"] {
			case "=", "!=", ">", "<":
			default:
				return invalidGraph("请选择有效的比较方式")
			}
			switch rule["value"].(type) {
			case bool, string, float64, int, json.Number:
			default:
				return invalidGraph("请填写比较值")
			}
			if !hasValue(rule["value"]) {
				return invalidGraph("请填写比较值")
			}
			if rule["operator_value"] == ">" || rule["operator_value"] == "<" {
				number := visibilityNumber(rule["value"])
				if math.IsNaN(number) || math.IsInf(number, 0) {
					return invalidGraph("请填写有效的数字比较值")
				}
			}
		default:
			return invalidGraph("请选择有效的条件类型")
		}
		return validateSource(stringValue(rule["node_id"]), stringValue(rule["field_id"]))
	default:
		return invalidGraph("请配置有效的显示条件")
	}
	return nil
}

func formFields(definition record) []record {
	return asRecords(asRecord(definition["form_schema"])["fields"])
}

func formFieldsForValidation(definition record, hidden map[string]bool) []record {
	var fields []record
	for _, field := range formFields(definition) {
		if !hidden[stringValue(field["id"])] {
			fields = append(fields, field)
		}
	}
	return fields
}

// Conditional visibility is separate from legacy hidden fields, which can store
// system values and still participate in rules and templates.
func conditionalHiddenFields(ticket, version, node, values record) map[string]bool {
	definitions := asRecords(version["nodes"])
	fieldsByNode := map[string][]record{}
	seen := map[[2]string]bool{}
	visible := map[[2]string]bool{}
	currentID := stringValue(node["node_id"])
	var fieldVisible func(string, string, record) bool
	fieldVisible = func(nodeID, fieldID string, sourceValues record) bool {
		key := [2]string{nodeID, fieldID}
		if seen[key] {
			return visible[key]
		}
		seen[key] = true
		fields, found := fieldsByNode[nodeID]
		if !found {
			fields = formFields(findRecord(definitions, nodeID))
			fieldsByNode[nodeID] = fields
		}
		field := findRecord(fields, fieldID)
		rule := asRecord(field["visibility_rule"])
		if field == nil {
			return false
		}
		visible[key] = rule == nil || visibilityRuleMatches(rule, func(sourceID, sourceField string) any {
			if sourceID == "" {
				sourceID = nodeID
			}
			input := sourceValues
			if sourceID != nodeID {
				parent := nodeByDefinition(ticket, sourceID)
				if parent["status"] != "completed" {
					return nil
				}
				input = asRecord(parent["values"])
			}
			if !fieldVisible(sourceID, sourceField, input) {
				return nil
			}
			return input[sourceField]
		})
		return visible[key]
	}

	hidden := map[string]bool{}
	for _, field := range formFields(findRecord(definitions, currentID)) {
		id := stringValue(field["id"])
		if field["visibility_rule"] != nil && !fieldVisible(currentID, id, values) {
			hidden[id] = true
		}
	}
	return hidden
}

func visibilityRuleMatches(rule record, valueFor func(string, string) any) bool {
	if rule["type"] == "group" {
		children := asRecords(rule["children"])
		if len(children) == 0 || (rule["operator"] != "AND" && rule["operator"] != "OR") {
			return false
		}
		anyMatch := rule["operator"] == "OR"
		for _, child := range children {
			if visibilityRuleMatches(child, valueFor) == anyMatch {
				return anyMatch
			}
		}
		return !anyMatch
	}
	value := valueFor(stringValue(rule["node_id"]), stringValue(rule["field_id"]))
	if !hasValue(value) {
		return false
	}
	if rule["kind"] == "field_filled" {
		return true
	}
	if rule["kind"] != "value_compare" {
		return false
	}
	expected := rule["value"]
	switch rule["operator_value"] {
	case "=":
		return comparableText(value) == comparableText(expected)
	case "!=":
		return comparableText(value) != comparableText(expected)
	case ">", "<":
		left, right := visibilityNumber(value), visibilityNumber(expected)
		if math.IsNaN(left) || math.IsNaN(right) || math.IsInf(left, 0) || math.IsInf(right, 0) {
			return false
		}
		if rule["operator_value"] == ">" {
			return left > right
		}
		return left < right
	}
	return false
}

func withoutConditionalFields(values record, hidden map[string]bool) record {
	if len(hidden) == 0 {
		return values
	}
	filtered := maps.Clone(values)
	for field := range hidden {
		delete(filtered, field)
	}
	return filtered
}

// Script and reference templates look up both current.values and nodes.*.values.
func templateFormContext(ticket, version, current record) (record, record) {
	projected := maps.Clone(ticket)
	nodes := make([]record, 0, len(asRecords(ticket["node_instances"])))
	for _, node := range asRecords(ticket["node_instances"]) {
		values := asRecord(node["values"])
		hidden := conditionalHiddenFields(ticket, version, node, values)
		if len(hidden) > 0 {
			node = maps.Clone(node)
			node["values"] = withoutConditionalFields(values, hidden)
			node["resources"] = withoutConditionalFields(asRecord(node["resources"]), hidden)
			var outputs []record
			for _, output := range asRecords(node["outputs"]) {
				if result := asRecord(output["value"]); output["key"] == "result" && result != nil {
					output = maps.Clone(output)
					output["value"] = withoutConditionalFields(result, hidden)
				}
				outputs = append(outputs, output)
			}
			node["outputs"] = outputs
		}
		nodes = append(nodes, node)
		if current["id"] == node["id"] {
			current = node
		}
	}
	projected["node_instances"] = nodes
	return projected, current
}
