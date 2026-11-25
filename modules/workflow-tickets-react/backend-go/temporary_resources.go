package main

import (
	"io"
	"maps"
	"net/http"
	"slices"
	"strings"
	"time"
)

const workflowModuleID = "workflow-tickets-react"

func temporaryResourceRead(item record, moduleID string) record {
	return record{
		"id": item["id"], "url": "/api/v1/modules/" + moduleID + "/temp/" + stringValue(item["token"]),
		"filename": item["filename"], "mime_type": item["mime_type"], "content": item["content"],
		"expires_at": item["expires_at"], "max_access_count": item["max_access_count"], "access_count": item["access_count"],
	}
}

func temporaryResourceActive(item record, now time.Time) bool {
	limit := item["max_access_count"]
	expires := scheduleTimestamp(item["expires_at"])
	return !truthy(item["revoked"]) && (expires.IsZero() || expires.After(now)) &&
		(limit == nil || numeric(item["access_count"]) < numeric(limit))
}

func (state *workflowState) prepareRuntimeResources(ticket, version, node, definition record, now string) {
	var hidden map[string]bool
	var context, current record
	for _, field := range formFields(definition) {
		template := stringValue(asRecord(field["config"])["execution_template"])
		if field["type"] != "script" || template == "" {
			continue
		}
		if hidden == nil {
			hidden = conditionalHiddenFields(ticket, version, node, asRecord(node["values"]))
		}
		id := stringValue(field["id"])
		if hidden[id] {
			state.revokeRuntimeResource(ticket, node, field)
			delete(asRecord(node["resources"]), id)
			continue
		}
		if context == nil {
			context, current = templateFormContext(ticket, version, node)
		}
		state.prepareRuntimeResource(ticket, node, field, renderTemplate(template, context, current), now)
	}
}

func (state *workflowState) revokeRuntimeResource(ticket, node, field record) {
	for _, item := range state.entities["temporary_resources"] {
		if item["ticket_id"] == ticket["id"] && item["ticket_node_id"] == node["id"] && item["field_id"] == field["id"] {
			item["revoked"] = true
		}
	}
}

func (state *workflowState) prepareRuntimeResource(ticket, node, field record, content, now string) {
	at := scheduleTimestamp(now)
	config := asRecord(field["config"])
	state.revokeRuntimeResource(ticket, node, field)
	language := stringValue(config["language"])
	filename, mimeType := "run.txt", "text/plain"
	switch language {
	case "", "shell", "bash":
		filename, mimeType = "run.sh", "text/x-shellscript"
	case "cmd":
		filename, mimeType = "run.cmd", "text/x-msdos-batch"
	case "powershell":
		filename, mimeType = "run.ps1", "text/x-powershell"
	case "python":
		filename, mimeType = "run.py", "text/x-python"
	}
	settings := state.normalizedSettings()
	limit := numeric(settings["temporary_resource_access_count"])
	if raw, exists := config["max_access_count"]; exists {
		limit = max(1, numberOrZero(raw))
	}
	item := record{
		"id": newID(), "token": newID(), "ticket_id": ticket["id"], "ticket_node_id": node["id"], "field_id": field["id"],
		"filename": stringOr(config["filename"], filename), "mime_type": mimeType, "content": content,
		"expires_at":       timestamp(at.Add(time.Duration(numeric(settings["temporary_resource_days"])) * 24 * time.Hour)),
		"max_access_count": limit, "access_count": 0, "revoked": false,
	}
	state.entities["temporary_resources"] = append(state.entities["temporary_resources"], item)
	resources := objectOrEmpty(node["resources"])
	resources[stringValue(field["id"])] = temporaryResourceRead(item, workflowModuleID)
	node["resources"] = resources
}

func (state *workflowState) cleanupTemporaryResources(now time.Time) {
	state.entities["temporary_resources"] = slices.DeleteFunc(state.entities["temporary_resources"], func(item record) bool {
		return !temporaryResourceActive(item, now)
	})
}

func (app *api) refreshTemporaryResources(state *workflowState, ticket record) {
	byToken := map[string]record{}
	for _, item := range matchingRecords(state.entities["temporary_resources"], "ticket_id", ticket["id"]) {
		byToken[stringValue(item["token"])] = item
	}
	for _, node := range asRecords(ticket["node_instances"]) {
		resources := maps.Clone(asRecord(node["resources"]))
		for field, value := range resources {
			address := strings.TrimRight(stringValue(asRecord(value)["url"]), "/")
			token := address[strings.LastIndex(address, "/")+1:]
			if current := byToken[token]; current != nil {
				resources[field] = temporaryResourceRead(current, app.moduleID)
			}
		}
		if resources != nil {
			node["resources"] = resources
		}
	}
}

func (app *api) serveTemporaryResource(w http.ResponseWriter, request *http.Request) {
	var item record
	err := app.repo.update(request.Context(), func(state *workflowState) error {
		token := request.PathValue("token")
		for _, candidate := range state.entities["temporary_resources"] {
			if candidate["token"] == token && temporaryResourceActive(candidate, time.Now()) {
				item = candidate
				item["access_count"] = numeric(item["access_count"]) + 1
				return nil
			}
		}
		return failure(404, "临时资源不存在或已失效")
	})
	if err != nil {
		writeError(w, err)
		return
	}
	mimeType := stringValue(item["mime_type"])
	switch mimeType {
	case "text/x-shellscript", "text/x-msdos-batch", "text/x-powershell", "text/x-python", "text/plain":
	default:
		mimeType = "text/plain"
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Type", mimeType)
	content, _ := item["content"].(string)
	_, _ = io.WriteString(w, content)
}
