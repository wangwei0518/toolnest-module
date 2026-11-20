package main

import (
	"net/http"
	"time"
)

func (state *workflowState) updateView(item, body record, now string) {
	updateTextFields(item, body, "name")
	if filters, ok := body["filters"]; ok {
		item["filters"] = objectOrEmpty(filters)
	}
	if favorite, ok := body["favorite"]; ok {
		item["favorite"] = truthy(favorite)
	}
	if value, ok := body["is_default"]; ok {
		item["is_default"] = truthy(value)
		if truthy(value) {
			for _, other := range state.entities["saved_views"] {
				if other["id"] != item["id"] {
					other["is_default"] = false
				}
			}
		}
	}
	item["updated_at"] = now
}

func (app *api) registerSavedViews(mux *http.ServeMux) {
	app.endpoint(mux, "GET /saved-views", false, func(state *workflowState, _ *http.Request, _ record) (any, error) {
		return sortedUpdated(state.entities["saved_views"]), nil
	})
	app.endpoint(mux, "POST /saved-views", true, func(state *workflowState, _ *http.Request, body record) (any, error) {
		name := stringValue(body["name"])
		if name == "" {
			return nil, failure(422, "视图名称不能为空")
		}
		now := timestamp(time.Now())
		item := record{"id": newID(), "name": name, "filters": record{}, "favorite": false, "is_default": false, "created_at": now}
		state.updateView(item, body, now)
		state.entities["saved_views"] = append([]record{item}, state.entities["saved_views"]...)
		return item, nil
	})
	app.endpoint(mux, "PUT /saved-views/{viewID}", true, func(state *workflowState, request *http.Request, body record) (any, error) {
		item := findRecord(state.entities["saved_views"], request.PathValue("viewID"))
		if item == nil {
			return nil, failure(404, "保存的视图不存在")
		}
		state.updateView(item, body, timestamp(time.Now()))
		return item, nil
	})
	app.endpoint(mux, "DELETE /saved-views/{viewID}", true, func(state *workflowState, request *http.Request, _ record) (any, error) {
		id := request.PathValue("viewID")
		if findRecord(state.entities["saved_views"], id) == nil {
			return nil, failure(404, "保存的视图不存在")
		}
		state.entities["saved_views"] = removeMatching(state.entities["saved_views"], "id", id)
		return nil, nil
	})
}
