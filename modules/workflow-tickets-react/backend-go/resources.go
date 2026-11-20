package main

import (
	"fmt"
	"maps"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"
)

func canonicalResourceType(kind string) string {
	if kind == "link" || kind == "url" {
		return "custom"
	}
	return kind
}

func projectIDsForResource(item record) []string {
	projects := normalizeStrings(item["project_ids"])
	if len(projects) == 0 {
		if id := stringValue(item["project_id"]); id != "" {
			return []string{id}
		}
	}
	return projects
}

func resourceRead(item record) record {
	result := maps.Clone(item)
	kind := canonicalResourceType(stringValue(defaultValue(item["resource_type"], item["type"])))
	result["type"], result["resource_type"] = kind, kind
	projects := projectIDsForResource(item)
	if len(projects) > 0 && result["project_id"] == nil {
		result["project_id"] = projects[0]
	} else {
		result["project_id"] = item["project_id"]
	}
	result["project_ids"] = defaultValue(item["project_ids"], projects)
	result["external_url"] = defaultValue(item["external_url"], item["url"])
	result["identifier"] = defaultValue(item["identifier"], "")
	return result
}

func (state *workflowState) normalizeResource(body, existing record, now string) (record, error) {
	projectID := stringValue(existing["project_id"])
	if value, ok := body["project_id"]; ok {
		projectID = stringValue(value)
	} else if projectID == "" {
		if ids := normalizeStrings(body["project_ids"]); len(ids) > 0 {
			projectID = ids[0]
		}
	}
	if _, _, err := state.resolveScope(projectID, ""); err != nil {
		return nil, err
	}
	kind := canonicalResourceType(stringOr(body["type"], stringOr(body["resource_type"], stringOr(existing["type"], "custom"))))
	if !slices.Contains([]string{"server", "repository", "document", "custom"}, kind) {
		return nil, failure(422, "资源类型无效")
	}
	name := stringOr(body["name"], stringValue(existing["name"]))
	if name == "" {
		return nil, failure(422, "资源名称不能为空")
	}
	address := stringValue(defaultValue(existing["url"], existing["external_url"]))
	if _, ok := firstProvided(body, "url", "external_url"); ok {
		address = stringOr(body["url"], stringValue(body["external_url"]))
	}
	if uri := strings.ToLower(address); uri != "" && !strings.HasPrefix(uri, "http://") && !strings.HasPrefix(uri, "https://") {
		return nil, failure(422, "外部链接必须以 http:// 或 https:// 开头")
	}
	attributes := maps.Clone(objectOrEmpty(existing["attributes"]))
	maps.Copy(attributes, asRecord(body["attributes"]))
	if port := stringValue(attributes["port"]); port != "" {
		number, err := strconv.Atoi(port)
		if err != nil || strings.Trim(port, "0123456789") != "" || number < 1 || number > 65535 {
			return nil, failure(422, "端口必须是 1 到 65535 之间的数字")
		}
	}
	links := func(key string) []string {
		if value, ok := body[key]; ok {
			return normalizeStrings(value)
		}
		return normalizeStrings(existing[key])
	}
	ticketIDs, milestoneIDs := links("ticket_ids"), links("milestone_ids")
	if projectID == "" && (len(ticketIDs) > 0 || len(milestoneIDs) > 0) {
		return nil, failure(422, "资源必须先关联项目，才能关联工单或里程碑")
	}
	for _, id := range ticketIDs {
		item, err := findTicket(state, id)
		if err != nil {
			return nil, err
		}
		if item["project_id"] != projectID {
			return nil, failure(422, "关联工单必须属于当前项目")
		}
	}
	for _, id := range milestoneIDs {
		_, item, err := state.resolveScope("", id)
		if err != nil {
			return nil, err
		}
		if item["project_id"] != projectID {
			return nil, failure(422, "关联里程碑必须属于当前项目")
		}
	}
	projectIDs := []string{}
	if projectID != "" {
		projectIDs = append(projectIDs, projectID)
	}
	item := maps.Clone(objectOrEmpty(existing))
	item["id"], item["name"], item["type"], item["resource_type"] = stringOr(existing["id"], newID()), name, kind, kind
	item["project_id"], item["project_ids"] = nullableString(projectID), projectIDs
	item["url"], item["external_url"], item["attributes"] = nullableString(address), nullableString(address), attributes
	item["ticket_ids"], item["milestone_ids"] = ticketIDs, milestoneIDs
	item["created_at"], item["updated_at"] = defaultValue(existing["created_at"], now), now
	item["identifier"], item["description"] = defaultValue(existing["identifier"], ""), defaultValue(existing["description"], "")
	updateTextFields(item, body, "identifier", "description")
	return item, nil
}

func (app *api) registerResources(mux *http.ServeMux) {
	app.endpoint(mux, "GET /resources", false, func(state *workflowState, request *http.Request, _ record) (any, error) {
		query := request.URL.Query()
		projectID, ticketID, milestoneID := query.Get("project_id"), query.Get("ticket_id"), query.Get("milestone_id")
		result := []record{}
		for _, item := range state.entities["resources"] {
			if (projectID == "" || slices.Contains(projectIDsForResource(item), projectID)) &&
				(ticketID == "" || slices.Contains(normalizeStrings(item["ticket_ids"]), ticketID)) &&
				(milestoneID == "" || slices.Contains(normalizeStrings(item["milestone_ids"]), milestoneID)) {
				result = append(result, resourceRead(item))
			}
		}
		return result, nil
	})
	app.endpoint(mux, "POST /resources", true, func(state *workflowState, _ *http.Request, body record) (any, error) {
		now := timestamp(time.Now())
		item, err := state.normalizeResource(body, nil, now)
		if err != nil {
			return nil, err
		}
		state.entities["resources"] = append([]record{item}, state.entities["resources"]...)
		event := state.ticketEvent(nil, nil, "resource_created", fmt.Sprintf("资源「%s」已创建", item["name"]), now)
		event["project_id"] = item["project_id"]
		return item, nil
	})
	app.endpoint(mux, "PUT /resources/{resourceID}", true, func(state *workflowState, request *http.Request, body record) (any, error) {
		item := findRecord(state.entities["resources"], request.PathValue("resourceID"))
		if item == nil {
			return nil, failure(404, "关联资源不存在")
		}
		next, err := state.normalizeResource(body, item, timestamp(time.Now()))
		if err != nil {
			return nil, err
		}
		maps.Copy(item, next)
		return item, nil
	})
	app.endpoint(mux, "DELETE /resources/{resourceID}", true, func(state *workflowState, request *http.Request, _ record) (any, error) {
		id := request.PathValue("resourceID")
		if findRecord(state.entities["resources"], id) == nil {
			return nil, failure(404, "关联资源不存在")
		}
		state.entities["resources"] = removeMatching(state.entities["resources"], "id", id)
		return nil, nil
	})
}
