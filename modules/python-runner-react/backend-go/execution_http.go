package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
)

func registerExecutionRoutes(routes *http.ServeMux, service *executions) {
	routes.Handle("POST /executions", endpoint(func(w http.ResponseWriter, r *http.Request) (any, error) {
		var input executionInput
		if err := readJSON(w, r, &input); err != nil {
			return nil, err
		}
		return service.create(r.Context(), input)
	}))
	routes.Handle("GET /executions", endpoint(func(_ http.ResponseWriter, r *http.Request) (any, error) {
		return service.list(r.Context())
	}))
	routes.Handle("GET /executions/{id}", endpoint(func(_ http.ResponseWriter, r *http.Request) (any, error) {
		return service.get(r.Context(), r.PathValue("id"))
	}))
	routes.Handle("DELETE /executions/{id}", endpoint(func(_ http.ResponseWriter, r *http.Request) (any, error) {
		return nil, service.remove(r.Context(), r.PathValue("id"))
	}))
	routes.Handle("POST /executions/{id}/stop", endpoint(func(_ http.ResponseWriter, r *http.Request) (any, error) {
		return service.stop(r.Context(), r.PathValue("id"))
	}))
	routes.Handle("POST /executions/{id}/rerun", endpoint(func(_ http.ResponseWriter, r *http.Request) (any, error) {
		return service.rerun(r.Context(), r.PathValue("id"))
	}))
	routes.Handle("GET /executions/{id}/logs", endpoint(func(_ http.ResponseWriter, r *http.Request) (any, error) {
		query := r.URL.Query()
		limit := 200
		if value, err := strconv.Atoi(query.Get("limit")); err == nil {
			limit = min(500, max(1, value))
		}
		offset, _ := strconv.Atoi(query.Get("after"))
		return service.logs(r.Context(), r.PathValue("id"), limit, max(0, offset))
	}))
	routes.HandleFunc("GET /executions/{id}/logs/stream", func(w http.ResponseWriter, r *http.Request) {
		events, err := service.logs(r.Context(), r.PathValue("id"), 200, 0)
		if err != nil {
			writeError(w, err)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		for _, event := range events {
			data, _ := json.Marshal(event)
			if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event.Type, data); err != nil {
				return
			}
		}
	})
}

func (e *executions) rerun(ctx context.Context, id string) (json.RawMessage, error) {
	raw, err := e.get(ctx, id)
	if err != nil {
		return nil, err
	}
	var previous struct {
		Name             string          `json:"name"`
		Source           executionSource `json:"source_config"`
		SourceType       string          `json:"source_type"`
		Code             string          `json:"code_snapshot"`
		Entry            string          `json:"entry_file"`
		Args             []string        `json:"args"`
		Timeout          float64         `json:"timeout_seconds"`
		WorkingDirectory *string         `json:"working_directory"`
	}
	if err := json.Unmarshal(raw, &previous); err != nil {
		return nil, err
	}
	previous.Source.Type = previous.SourceType
	previous.Source.EntryFile = previous.Entry
	if previous.SourceType == "inline" {
		previous.Source.Code = previous.Code
	}
	var metadata struct {
		Source struct {
			Notification any `json:"notification_config"`
		} `json:"source_config"`
	}
	if err := json.Unmarshal(raw, &metadata); err != nil {
		return nil, err
	}
	return e.create(ctx, executionInput{
		Name: previous.Name, Source: previous.Source, Args: previous.Args,
		TimeoutSeconds: &previous.Timeout, WorkingDirectory: previous.WorkingDirectory, Notification: metadata.Source.Notification,
	})
}

type executionLog struct {
	Type      string `json:"type"`
	Content   string `json:"content"`
	Timestamp string `json:"timestamp"`
	Cursor    string `json:"cursor"`
}

func (e *executions) logs(ctx context.Context, id string, limit, offset int) ([]executionLog, error) {
	raw, err := e.get(ctx, id)
	if err != nil {
		return nil, err
	}
	var row struct {
		Stdout    string `json:"stdout"`
		Stderr    string `json:"stderr"`
		UpdatedAt string `json:"updated_at"`
	}
	if err := json.Unmarshal(raw, &row); err != nil {
		return nil, err
	}
	events := []executionLog{}
	for _, stream := range []struct{ name, content string }{{"stdout", row.Stdout}, {"stderr", row.Stderr}} {
		lines := strings.Split(strings.ReplaceAll(stream.content, "\r\n", "\n"), "\n")
		lines = nonemptyLines(lines)
		for _, line := range lines[max(0, len(lines)-limit):] {
			events = append(events, executionLog{stream.name, line, row.UpdatedAt, strconv.Itoa(len(events) + 1)})
		}
	}
	start := min(offset, len(events))
	return events[start : start+min(limit, len(events)-start)], nil
}

func nonemptyLines(lines []string) []string {
	result := lines[:0]
	for _, line := range lines {
		if line != "" {
			result = append(result, line)
		}
	}
	return result
}
