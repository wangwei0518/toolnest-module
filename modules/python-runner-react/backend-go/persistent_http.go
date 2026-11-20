package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

const persistentLogLimit = 5 << 20

func (s *persistentService) logPath(id string) string {
	return filepath.Join(s.config.logDir, "persistent", id+".log")
}

type persistentOutput struct {
	s        *persistentService
	filename string
}

func (p persistentOutput) Write(data []byte) (int, error) {
	p.s.logMu.Lock()
	defer p.s.logMu.Unlock()
	file, err := os.OpenFile(p.filename, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		return 0, err
	}
	n, err := file.Write(data)
	if err := errors.Join(err, file.Close()); err != nil {
		return n, err
	}
	info, err := os.Stat(p.filename)
	if err != nil || info.Size() <= persistentLogLimit {
		return n, err
	}
	tail, _, err := readTail(p.filename, 4<<20)
	if err != nil {
		return n, err
	}
	tail = strings.TrimLeftFunc(tail, func(r rune) bool { return r == utf8.RuneError })
	return n, os.WriteFile(p.filename, []byte(tail), 0600)
}

func (s *persistentService) logs(ctx context.Context, id string, limit int, clear bool) (map[string]any, error) {
	if _, err := taskPath(id); err != nil {
		return nil, err
	}
	var ts string
	err := s.db.QueryRow(ctx, "SELECT to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') FROM pr_persistent_tasks WHERE id=$1", id).Scan(&ts)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, notFound("常驻任务不存在。")
	}
	if err != nil {
		return nil, err
	}
	s.logMu.Lock()
	defer s.logMu.Unlock()
	path := s.logPath(id)
	if clear {
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			return nil, err
		}
		if err := os.WriteFile(path, nil, 0600); err != nil {
			return nil, err
		}
	}
	content, truncated, err := readTail(path, persistentLogLimit)
	if err != nil {
		return nil, err
	}
	lines := nonemptyLines(strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n"))
	truncated = truncated || len(lines) > limit
	lines = lines[max(0, len(lines)-limit):]
	return map[string]any{"task_id": id, "lines": lines, "truncated": truncated, "log_size": len(content), "updated_at": ts}, nil
}

func (s *persistentService) events(ctx context.Context, id string, limit int) ([]json.RawMessage, error) {
	if _, err := s.get(ctx, id); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx, "SELECT to_jsonb(e) FROM pr_persistent_events e WHERE task_id=$1 ORDER BY created_at DESC LIMIT $2", id, limit)
	if err != nil {
		return nil, err
	}
	return pgx.AppendRows([]json.RawMessage{}, rows, pgx.RowTo[json.RawMessage])
}

func boundedQueryInt(r *http.Request, key string, fallback, maximum int) int {
	value, err := strconv.Atoi(r.URL.Query().Get(key))
	if err != nil {
		value = fallback
	}
	return min(maximum, max(1, value))
}

func registerPersistentRoutes(routes *http.ServeMux, s *persistentService) {
	routes.Handle("GET /persistent-tasks", endpoint(func(_ http.ResponseWriter, r *http.Request) (any, error) {
		page, size := pageParams(r)
		return s.list(r.Context(), strings.TrimSpace(r.URL.Query().Get("keyword")), strings.TrimSpace(r.URL.Query().Get("status")), page, size)
	}))
	save := func(update bool) endpoint {
		return func(w http.ResponseWriter, r *http.Request) (any, error) {
			id := ""
			if update {
				id = r.PathValue("id")
			}
			var input persistentInput
			if err := readJSON(w, r, &input); err != nil {
				return nil, err
			}
			return s.save(r.Context(), id, input)
		}
	}
	routes.Handle("POST /persistent-tasks", save(false))
	routes.Handle("PUT /persistent-tasks/{id}", save(true))
	routes.Handle("GET /persistent-tasks/{id}", endpoint(func(_ http.ResponseWriter, r *http.Request) (any, error) {
		return s.get(r.Context(), r.PathValue("id"))
	}))
	routes.Handle("DELETE /persistent-tasks/{id}", endpoint(func(_ http.ResponseWriter, r *http.Request) (any, error) {
		return nil, s.remove(r.Context(), r.PathValue("id"))
	}))
	for _, action := range []string{"start", "stop", "restart"} {
		routes.Handle("POST /persistent-tasks/{id}/"+action, endpoint(func(_ http.ResponseWriter, r *http.Request) (any, error) {
			return s.control(r.Context(), r.PathValue("id"), action)
		}))
	}
	routes.Handle("GET /persistent-tasks/{id}/logs", endpoint(func(_ http.ResponseWriter, r *http.Request) (any, error) {
		return s.logs(r.Context(), r.PathValue("id"), boundedQueryInt(r, "lines", 300, 1000), false)
	}))
	routes.Handle("POST /persistent-tasks/{id}/logs/clear", endpoint(func(_ http.ResponseWriter, r *http.Request) (any, error) {
		return s.logs(r.Context(), r.PathValue("id"), 300, true)
	}))
	routes.Handle("GET /persistent-tasks/{id}/events", endpoint(func(_ http.ResponseWriter, r *http.Request) (any, error) {
		return s.events(r.Context(), r.PathValue("id"), boundedQueryInt(r, "limit", 50, 200))
	}))
}
