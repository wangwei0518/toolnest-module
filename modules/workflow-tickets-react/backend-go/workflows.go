package main

import (
	"encoding/json"
	"maps"
	"reflect"
	"slices"
	"strconv"
	"strings"
)

func failure(status int, message string) error {
	return &domainError{status: status, message: message}
}

func findRecord(entries []record, id string) record {
	if id != "" {
		for _, item := range entries {
			if item["id"] == id {
				return item
			}
		}
	}
	return nil
}

func stringOr(value any, fallback string) string {
	if text := stringValue(value); text != "" {
		return text
	}
	return fallback
}

func nullableString(value any) any {
	if text := stringValue(value); text != "" {
		return text
	}
	return nil
}

func objectOrEmpty(value any) record {
	if object := asRecord(value); object != nil {
		return object
	}
	return record{}
}

func array(value any) []any {
	if items, ok := value.([]any); ok {
		return items
	}
	return []any{}
}

func truthy(value any) bool {
	switch value := value.(type) {
	case nil:
		return false
	case bool:
		return value
	case string:
		return value != ""
	case json.Number:
		n, _ := value.Float64()
		return n != 0
	case int:
		return value != 0
	case float64:
		return value != 0
	default:
		return true
	}
}

func numberOrZero(value any) float64 {
	n, _ := strconv.ParseFloat(stringValue(value), 64)
	if n != n || n > 1.7976931348623157e308 || n < -1.7976931348623157e308 {
		return 0
	}
	return n
}

func (state *workflowState) workflow(id string) (record, error) {
	if item := findRecord(state.entities["workflows"], id); item != nil {
		return item, nil
	}
	return nil, failure(404, "工作流不存在")
}

func defaultWorkflow(name, description string, groupName any, now string, published bool) record {
	workflowID, versionID := newID(), newID()
	makeNode := func(name, key, description string, field, rule record, x int) record {
		return record{
			"id": newID(), "name": name, "key": key, "description": description,
			"node_type": "general", "status": "ready", "position": record{"x": x, "y": 140},
			"form_schema":     record{"fields": []record{field}},
			"completion_rule": record{"type": "group", "operator": "AND", "children": []record{rule}},
			"actions":         []record{}, "inputs": []record{}, "outputs": []record{},
		}
	}
	first := makeNode("准备资料", "prepare", "准备当前节点需要的输入。",
		record{"id": "context", "type": "textarea", "label": "执行说明", "required": true, "placeholder": "记录本节点的输入或约束"},
		record{"type": "rule", "kind": "field_filled", "field_id": "context", "label": "执行说明"}, 80)
	second := makeNode("执行处理", "process", "执行并记录实际处理过程。",
		record{"id": "result", "type": "textarea", "label": "处理结果", "required": true},
		record{"type": "rule", "kind": "field_filled", "field_id": "result", "label": "处理结果"}, 360)
	third := makeNode("结果确认", "confirm", "确认结果并沉淀可复用输出。",
		record{"id": "confirmed", "type": "switch", "label": "已确认", "required": true},
		record{"type": "rule", "kind": "manual_confirm", "field_id": "confirmed", "label": "人工确认"}, 640)
	status, publishNote := "draft", ""
	var publishedAt any
	if published {
		status, publishNote, publishedAt = "published", "系统初始化", now
	}
	version := record{
		"id": versionID, "workflow_id": workflowID, "version": 1, "status": status,
		"change_note": "系统初始化", "publish_note": publishNote, "created_at": now, "published_at": publishedAt,
		"nodes": []record{first, second, third}, "ticket_count": 0,
		"edges": []record{
			{"id": newID(), "source_node_id": first["id"], "target_node_id": second["id"]},
			{"id": newID(), "source_node_id": second["id"], "target_node_id": third["id"]},
		},
	}
	return record{
		"id": workflowID, "name": name, "description": description, "group_name": nullableString(groupName),
		"status": status, "created_at": now, "updated_at": now, "current_version_id": versionID, "versions": []record{version},
	}
}

func workflowRead(workflow record, usage map[string]int) record {
	result := maps.Clone(workflow)
	versions := []record{}
	for _, item := range asRecords(workflow["versions"]) {
		version := maps.Clone(item)
		version["ticket_count"] = usage[stringValue(version["id"])]
		if version["status"] == "published" {
			result["status"] = "published"
		}
		versions = append(versions, version)
	}
	result["versions"] = versions
	return result
}

func (state *workflowState) versionUsage() map[string]int {
	usage := make(map[string]int)
	for _, item := range state.entities["tickets"] {
		usage[stringValue(item["workflow_version_id"])]++
	}
	return usage
}

func (state *workflowState) listWorkflows(keyword string) []record {
	result := []record{}
	usage := state.versionUsage()
	keyword = strings.ToLower(keyword)
	for _, item := range state.entities["workflows"] {
		if item["status"] != "archived" && strings.Contains(strings.ToLower(stringValue(item["name"])+" "+stringValue(item["description"])), keyword) {
			result = append(result, workflowRead(item, usage))
		}
	}
	return result
}

func (state *workflowState) createWorkflow(body record, now string) (record, error) {
	name := stringValue(body["name"])
	if name == "" {
		return nil, failure(422, "工作流名称不能为空")
	}
	workflow := defaultWorkflow(name, stringValue(body["description"]), body["group_name"], now, false)
	state.entities["workflows"] = append([]record{workflow}, state.entities["workflows"]...)
	return workflowRead(workflow, nil), nil
}

func publishedVersion(workflow record) record {
	var selected record
	for _, version := range asRecords(workflow["versions"]) {
		if version["status"] == "published" && (selected == nil || numberOrZero(version["version"]) > numberOrZero(selected["version"])) {
			selected = version
		}
	}
	return selected
}

func lastVersion(versions []record) record {
	if len(versions) != 0 {
		return versions[len(versions)-1]
	}
	return nil
}

func addDraft(workflow, source record, note, now string) record {
	versions := asRecords(workflow["versions"])
	next := 0
	for _, item := range versions {
		next = max(next, int(numberOrZero(item["version"])))
	}
	// Updating a draft replaces its graph as a whole. The graph is shared
	// with the source until replacement, and never mutated by version edits.
	version := maps.Clone(source)
	version["id"], version["version"], version["status"] = newID(), next+1, "draft"
	version["change_note"], version["publish_note"], version["source_version_id"] = note, "", source["id"]
	version["created_at"], version["published_at"], version["ticket_count"] = now, nil, 0
	workflow["versions"] = append(versions, version)
	workflow["current_version_id"] = version["id"]
	return version
}

func (state *workflowState) createVersion(workflow, body record, now string) (record, error) {
	versions := asRecords(workflow["versions"])
	source := findRecord(versions, stringValue(body["source_version_id"]))
	if source == nil {
		source = publishedVersion(workflow)
	}
	if source == nil {
		source = lastVersion(versions)
	}
	if source == nil {
		return nil, failure(409, "没有可复制的来源版本")
	}
	version := addDraft(workflow, source, stringValue(body["change_note"]), now)
	workflow["status"], workflow["updated_at"] = "draft", now
	return version, nil
}

func normalizeNode(raw record) record {
	fields := []record{}
	for _, value := range array(asRecord(raw["form_schema"])["fields"]) {
		field := asRecord(value)
		options, items := []record{}, []record{}
		for _, optionRaw := range array(field["options"]) {
			option := asRecord(optionRaw)
			options = append(options, record{"label": stringValue(option["label"]), "value": option["value"]})
		}
		for _, itemRaw := range array(field["items"]) {
			item := asRecord(itemRaw)
			id, label := stringValue(item["id"]), stringValue(item["label"])
			if id != "" || label != "" {
				items = append(items, record{"id": id, "label": label})
			}
		}
		normalized := record{
			"id": stringOr(field["id"], newID()), "type": stringOr(field["type"], "text"),
			"label": stringOr(field["label"], "未命名字段"), "description": stringValue(field["description"]),
			"placeholder": stringValue(field["placeholder"]), "required": truthy(field["required"]),
			"readonly": truthy(field["readonly"]), "hidden": truthy(field["hidden"]), "options": options,
			"items": items, "config": objectOrEmpty(field["config"]),
		}
		if rule, exists := field["visibility_rule"]; exists && rule != nil {
			normalized["visibility_rule"] = rule
		}
		if value, ok := field["default"]; ok {
			normalized["default"] = value
		}
		if template := stringValue(field["default_template"]); template != "" {
			normalized["default_template"] = template
		}
		if ref := asRecord(field["reference"]); stringValue(ref["path"]) != "" {
			normalized["reference"] = ref
		}
		fields = append(fields, normalized)
	}
	position := asRecord(raw["position"])
	nodeType := "general"
	if raw["node_type"] == "summary" {
		nodeType = "summary"
	}
	node := record{
		"id": stringOr(raw["id"], newID()), "name": stringOr(raw["name"], "未命名节点"),
		"key": stringOr(raw["key"], "node-"+newID()[:8]), "description": stringValue(raw["description"]),
		"node_type": nodeType, "status": stringValue(raw["status"]),
		"position":    record{"x": numberOrZero(position["x"]), "y": numberOrZero(position["y"])},
		"form_schema": record{"fields": fields}, "completion_rule": objectOrEmpty(raw["completion_rule"]),
		"predecessor_rule": nil,
	}
	if rule := asRecord(raw["predecessor_rule"]); rule != nil {
		node["predecessor_rule"] = rule
	}
	for _, key := range []string{"actions", "inputs", "outputs"} {
		items := []record{}
		for _, item := range array(raw[key]) {
			items = append(items, objectOrEmpty(item))
		}
		node[key] = items
	}
	return node
}

func normalizeEdge(raw record) record {
	return record{
		"id": stringOr(raw["id"], newID()), "source_node_id": stringValue(raw["source_node_id"]),
		"target_node_id": stringValue(raw["target_node_id"]), "source_side": stringValue(raw["source_side"]),
		"target_side": stringValue(raw["target_side"]), "priority": numberOrZero(raw["priority"]),
		"condition": objectOrEmpty(raw["condition"]), "condition_mode": stringOr(raw["condition_mode"], "unconditional"),
	}
}

func (state *workflowState) updateWorkflow(workflow, body record, now string) (record, error) {
	versions := asRecords(workflow["versions"])
	requested := stringValue(body["version_id"])
	version := findRecord(versions, stringOr(body["version_id"], stringValue(workflow["current_version_id"])))
	if requested != "" && version == nil {
		return nil, failure(404, "版本不存在")
	}
	if version == nil || version["status"] != "draft" {
		source := lastVersion(versions)
		if source == nil {
			return nil, failure(409, "版本不存在")
		}
		version = addDraft(workflow, source, "", now)
	}
	if name, ok := body["name"]; ok {
		if stringValue(name) == "" {
			return nil, failure(422, "工作流名称不能为空")
		}
		workflow["name"] = stringValue(name)
	}
	if description, ok := body["description"]; ok {
		workflow["description"] = stringValue(description)
	}
	if group, ok := body["group_name"]; ok {
		workflow["group_name"] = nullableString(group)
	}
	for _, field := range []struct {
		key       string
		normalize func(record) record
	}{{"nodes", normalizeNode}, {"edges", normalizeEdge}} {
		if values, ok := body[field.key].([]any); ok {
			items := make([]record, 0, len(values))
			for _, value := range values {
				items = append(items, field.normalize(asRecord(value)))
			}
			version[field.key] = items
		}
	}
	if err := validateGraph(asRecords(version["nodes"]), asRecords(version["edges"])); err != nil {
		return nil, err
	}
	workflow["updated_at"] = now
	return workflowRead(workflow, state.versionUsage()), nil
}

func (state *workflowState) publishWorkflow(workflow, body record, now string) (record, error) {
	versions := asRecords(workflow["versions"])
	version := findRecord(versions, stringOr(body["version_id"], stringValue(workflow["current_version_id"])))
	if version == nil {
		return nil, failure(404, "版本不存在")
	}
	if version["status"] != "draft" {
		return nil, failure(409, "只有草稿版本可以发布")
	}
	if err := validateGraph(asRecords(version["nodes"]), asRecords(version["edges"])); err != nil {
		return nil, err
	}
	if err := validateVisibilityRules(asRecords(version["nodes"]), asRecords(version["edges"])); err != nil {
		return nil, err
	}
	for _, item := range versions {
		if item["status"] == "published" {
			item["status"] = "archived"
		}
	}
	version["status"], version["publish_note"], version["published_at"] = "published", stringValue(body["publish_note"]), now
	workflow["current_version_id"], workflow["status"], workflow["updated_at"] = version["id"], "published", now
	return workflowRead(workflow, state.versionUsage()), nil
}

func (state *workflowState) archiveWorkflow(workflow record, now string) record {
	workflow["status"], workflow["updated_at"] = "archived", now
	for _, version := range asRecords(workflow["versions"]) {
		if version["status"] == "draft" {
			version["status"] = "archived"
		}
	}
	return workflowRead(workflow, state.versionUsage())
}

func compareVersions(workflow record, baseID, targetID string) (record, error) {
	versions := asRecords(workflow["versions"])
	base, target := findRecord(versions, baseID), findRecord(versions, targetID)
	if base == nil || target == nil {
		return nil, failure(404, "版本不存在")
	}
	baseNodes, targetNodes := asRecords(base["nodes"]), asRecords(target["nodes"])
	added, removed, changed := []record{}, []record{}, []record{}
	for _, item := range targetNodes {
		old := findRecord(baseNodes, stringValue(item["id"]))
		if old == nil {
			added = append(added, item)
		} else {
			left, right := maps.Clone(old), maps.Clone(item)
			delete(left, "position")
			delete(right, "position")
			if !reflect.DeepEqual(left, right) {
				changed = append(changed, item)
			}
		}
	}
	for _, item := range baseNodes {
		if findRecord(targetNodes, stringValue(item["id"])) == nil {
			removed = append(removed, item)
		}
	}
	diffEdges := func(values, others []record) []record {
		result := []record{}
		for _, value := range values {
			if !slices.ContainsFunc(others, func(other record) bool { return reflect.DeepEqual(value, other) }) {
				result = append(result, value)
			}
		}
		return result
	}
	baseEdges, targetEdges := asRecords(base["edges"]), asRecords(target["edges"])
	return record{
		"base_version": base["version"], "target_version": target["version"], "added_nodes": added,
		"removed_nodes": removed, "changed_nodes": changed,
		"added_edges": diffEdges(targetEdges, baseEdges), "removed_edges": diffEdges(baseEdges, targetEdges),
	}, nil
}

func dryRun(workflow, body record) (record, error) {
	versions := asRecords(workflow["versions"])
	version := publishedVersion(workflow)
	if version == nil {
		version = findRecord(versions, stringValue(workflow["current_version_id"]))
	}
	if version == nil {
		version = lastVersion(versions)
	}
	if version == nil {
		return nil, failure(409, "工作流没有版本")
	}
	nodes := []record{}
	for _, node := range asRecords(version["nodes"]) {
		status := "ready"
		if truthy(node["predecessor_rule"]) {
			status = "waiting"
		}
		nodes = append(nodes, record{"node_id": node["id"], "name": node["name"], "status": status, "completion_rule": node["completion_rule"]})
	}
	return record{
		"workflow_id": workflow["id"], "version": version["version"], "nodes": nodes,
		"initial_values": objectOrEmpty(body["initial_values"]), "actions_executed": false,
		"explanation": "预演不会写入工单、动态或动作执行记录。",
	}, nil
}
