package main

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"slices"
	"strconv"
	"strings"
)

func hasValue(value any) bool {
	if values, ok := value.([]any); ok {
		return len(values) != 0
	}
	return stringValue(value) != ""
}

func numeric(value any) float64 {
	switch value := value.(type) {
	case nil:
		return 0
	case bool:
		if value {
			return 1
		}
		return 0
	}
	text := stringValue(value)
	if text == "" {
		return 0
	}
	if number, err := strconv.ParseFloat(text, 64); err == nil {
		return number
	}
	return math.NaN()
}

func validateValues(fields []record, values record, require bool) []string {
	var failures []string
	for _, field := range fields {
		value := values[stringValue(field["id"])]
		label := stringValue(field["label"])
		if !hasValue(value) {
			if require && truthy(field["required"]) {
				failures = append(failures, fmt.Sprintf("「%s」为必填项", label))
			}
			continue
		}
		// Read-only and reference fields display existing output rather than user input.
		if truthy(field["readonly"]) || stringValue(asRecord(field["reference"])["path"]) != "" {
			continue
		}
		switch field["type"] {
		case "number":
			number := numeric(value)
			config := asRecord(field["config"])
			minimum, hasMin := config["min"]
			maximum, hasMax := config["max"]
			switch {
			case math.IsNaN(number) || math.IsInf(number, 0):
				failures = append(failures, fmt.Sprintf("「%s」必须是数字", label))
			case hasMax && number > numeric(maximum):
				failures = append(failures, fmt.Sprintf("「%s」不能大于 %v", label, maximum))
			case hasMin && number < numeric(minimum):
				failures = append(failures, fmt.Sprintf("「%s」不能小于 %v", label, minimum))
			}
		case "json":
			if text, ok := value.(string); ok && !json.Valid([]byte(text)) {
				failures = append(failures, fmt.Sprintf("「%s」不是有效 JSON", label))
			}
		case "url":
			address := strings.ToLower(stringValue(value))
			if !strings.HasPrefix(address, "http://") && !strings.HasPrefix(address, "https://") {
				failures = append(failures, fmt.Sprintf("「%s」必须是有效 URL", label))
			}
		}
	}
	return failures
}

func nodeByDefinition(ticket record, id string) record {
	for _, node := range asRecords(ticket["node_instances"]) {
		if node["node_id"] == id {
			return node
		}
	}
	return nil
}

func (state *workflowState) evaluateRule(rule, ticket, node record) bool {
	result, _ := state.evaluateFormRule(rule, ticket, node, nil, true)
	return result
}

// An inapplicable leaf is omitted from completion checks. For routing it is
// unknown, so neither an affirmative nor an inverse edge can match it alone.
func (state *workflowState) evaluateFormRule(rule, ticket, node record, hidden map[string]bool, completion bool) (bool, bool) {
	children, hasGroup := rule["children"].([]any)
	if !hasGroup {
		children, hasGroup = rule["rules"].([]any)
	}
	if !hasGroup {
		for _, key := range []string{"children", "rules"} {
			if records, ok := rule[key].([]record); ok {
				children = make([]any, len(records))
				for i, child := range records {
					children[i] = child
				}
				hasGroup = true
				break
			}
		}
	}
	var result bool
	if hasGroup {
		any := strings.EqualFold(stringValue(rule["operator"]), "OR")
		result = !any
		applicable, unknown := len(children) == 0, false
		for _, child := range children {
			passed, known := state.evaluateFormRule(asRecord(child), ticket, node, hidden, completion)
			if !known {
				unknown = true
				continue
			}
			applicable = true
			if passed == any {
				result = any
				break
			}
		}
		if !applicable || (!completion && unknown && result != any) {
			return false, false
		}
	} else {
		if rule["kind"] != "node_status" && hidden[stringValue(rule["field_id"])] {
			return false, false
		}
		result = state.evaluateLeaf(rule, ticket, node, hidden)
	}
	return result != (rule["negate"] == true), true
}

func (state *workflowState) evaluateLeaf(rule, ticket, node record, hidden map[string]bool) bool {
	field := stringValue(rule["field_id"])
	value := asRecord(node["values"])[field]
	switch rule["kind"] {
	case "field_filled":
		return hasValue(value)
	case "manual_confirm":
		return value == true || value == "true"
	case "checklist_complete":
		items := array(value)
		if len(items) == 0 {
			return false
		}
		for _, item := range items {
			if object := asRecord(item); object != nil {
				selected := object["completed"]
				if selected == nil {
					selected = object["checked"]
				}
				if !truthy(selected) {
					return false
				}
			} else if item == nil {
				return false
			}
		}
		return true
	case "attachment_count":
		count := 0
		for _, item := range state.entities["attachments"] {
			if item["ticket_node_id"] == node["id"] && !hidden[stringValue(item["field_id"])] && (field == "" || item["field_id"] == field) {
				count++
			}
		}
		minimum := 1.0
		if threshold := defaultValue(rule["count"], rule["value"]); threshold != nil {
			minimum = numeric(threshold)
		}
		return float64(count) >= minimum
	case "node_status":
		other := nodeByDefinition(ticket, stringOr(rule["node_id"], stringValue(rule["field_id"])))
		status := stringValue(other["status"])
		if other == nil {
			return false
		}
		if statuses := array(rule["statuses"]); len(statuses) > 0 {
			return slices.ContainsFunc(statuses, func(wanted any) bool { return stringValue(wanted) == status })
		}
		return status == stringOr(rule["status"], stringOr(rule["value"], "completed"))
	case "value_compare":
		operator, expected := comparisonRuleParts(rule)
		switch operator {
		case "=", "==", "equals":
			return comparableText(value) == comparableText(expected)
		case "!=", "not_equals":
			return comparableText(value) != comparableText(expected)
		case ">", "greater_than":
			return numeric(value) > numeric(expected)
		case "<", "less_than":
			return numeric(value) < numeric(expected)
		case ">=", "greater_or_equal":
			return numeric(value) >= numeric(expected)
		case "<=", "less_or_equal":
			return numeric(value) <= numeric(expected)
		case "contains":
			return strings.Contains(comparableText(value), comparableText(expected))
		case "not_contains":
			return !strings.Contains(comparableText(value), comparableText(expected))
		default:
			return hasValue(value)
		}
	default:
		return true
	}
}

func comparisonRuleParts(rule record) (string, any) {
	operator := stringValue(rule["operator"])
	editorOperator := stringValue(rule["operator_value"])
	// The designer writes the operator to operator_value and the operand
	// to value. Older rules can instead put the operand in operator_value.
	switch editorOperator {
	case "=", "==", "!=", ">", "<", ">=", "<=", "equals", "not_equals", "greater_than", "less_than", "greater_or_equal", "less_or_equal", "contains", "not_contains":
		if value, exists := rule["value"]; exists || operator == "" {
			return editorOperator, value
		}
	}
	if operator != "" {
		return operator, defaultValue(rule["operator_value"], rule["value"])
	}
	return "equals", rule["value"]
}

func comparableText(value any) string {
	switch val := value.(type) {
	case nil:
		return "null"
	case []any:
		items := make([]string, len(val))
		for i, item := range val {
			if item != nil {
				items[i] = comparableText(item)
			}
		}
		return strings.Join(items, ",")
	case record, map[string]any:
		return "[object Object]"
	default:
		return fmt.Sprint(value)
	}
}

var templateExpression = regexp.MustCompile(`\{\{\s*([^}]+?)\s*\}\}`)

func renderTemplate(template string, ticket, node record) string {
	return templateExpression.ReplaceAllStringFunc(template, func(match string) string {
		expression := strings.TrimSpace(match[2 : len(match)-2])
		if field, ok := strings.CutPrefix(expression, "current.values."); ok {
			return stringValue(asRecord(node["values"])[field])
		}
		value, _ := resolveReference(ticket, expression)
		return stringValue(value)
	})
}

func resolveReference(ticket record, reference string) (any, bool) {
	if reference == "ticket.title" || reference == "ticket.number" {
		value, exists := ticket[strings.TrimPrefix(reference, "ticket.")]
		return value, exists
	}
	parts := strings.SplitN(reference, ".", 4)
	if len(parts) != 4 || parts[0] != "nodes" {
		return nil, false
	}
	for _, node := range asRecords(ticket["node_instances"]) {
		if node["key"] != parts[1] {
			continue
		}
		switch parts[2] {
		case "values", "resources":
			value, exists := asRecord(node[parts[2]])[parts[3]]
			return value, exists
		case "outputs":
			outputs := asRecords(node["outputs"])
			if i, err := strconv.Atoi(parts[3]); err == nil && i >= 0 && i < len(outputs) {
				return outputs[i], true
			}
			for _, output := range outputs {
				if output["key"] == parts[3] {
					value, exists := output["value"]
					return value, exists
				}
			}
		}
		break
	}
	return nil, false
}

func hydrateDefaults(ticket, version, node, definition record) {
	values := objectOrEmpty(node["values"])
	node["values"] = values
	for _, field := range asRecords(asRecord(definition["form_schema"])["fields"]) {
		key := stringValue(field["id"])
		if _, set := values[key]; set {
			continue
		}
		if reference := stringValue(asRecord(field["reference"])["path"]); reference != "" {
			context, _ := templateFormContext(ticket, version, node)
			if value, exists := resolveReference(context, reference); exists {
				values[key] = value
			}
		} else if value, exists := field["default"]; exists {
			values[key] = value
		} else if template := stringValue(field["default_template"]); template != "" {
			context, current := templateFormContext(ticket, version, node)
			values[key] = renderTemplate(template, context, current)
		} else {
			switch field["type"] {
			case "switch":
				values[key] = false
			case "multiselect", "checklist", "todo":
				values[key] = []any{}
			}
		}
	}
	node["values"] = values
}
