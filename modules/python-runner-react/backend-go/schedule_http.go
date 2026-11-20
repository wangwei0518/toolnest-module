package main

import (
	"net/http"
	"strconv"
	"strings"
)

func pageParams(r *http.Request) (int, int) {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	size, err := strconv.Atoi(q.Get("page_size"))
	if err != nil {
		size = 20
	}
	return min(1_000_000, max(1, page)), min(100, max(1, size))
}

func registerScheduleRoutes(routes *http.ServeMux, s *scheduleService) {
	routes.Handle("GET /scheduled-tasks", endpoint(func(_ http.ResponseWriter, r *http.Request) (any, error) {
		page, size := pageParams(r)
		return s.list(r.Context(), strings.TrimSpace(r.URL.Query().Get("keyword")), strings.TrimSpace(r.URL.Query().Get("status")), page, size)
	}))
	save := func(update bool) endpoint {
		return func(w http.ResponseWriter, r *http.Request) (any, error) {
			id := ""
			if update {
				id = r.PathValue("id")
			}
			var input scheduleInput
			if err := readJSON(w, r, &input); err != nil {
				return nil, err
			}
			return s.save(r.Context(), id, input)
		}
	}
	routes.Handle("POST /scheduled-tasks", save(false))
	routes.Handle("PUT /scheduled-tasks/{id}", save(true))
	routes.Handle("GET /scheduled-tasks/{id}", endpoint(func(_ http.ResponseWriter, r *http.Request) (any, error) {
		return s.get(r.Context(), r.PathValue("id"))
	}))
	routes.Handle("DELETE /scheduled-tasks/{id}", endpoint(func(_ http.ResponseWriter, r *http.Request) (any, error) {
		return nil, s.remove(r.Context(), r.PathValue("id"))
	}))
	toggle := func(enabled bool) endpoint {
		return func(_ http.ResponseWriter, r *http.Request) (any, error) {
			return s.toggle(r.Context(), r.PathValue("id"), enabled)
		}
	}
	routes.Handle("POST /scheduled-tasks/{id}/enable", toggle(true))
	routes.Handle("POST /scheduled-tasks/{id}/disable", toggle(false))
	routes.Handle("POST /scheduled-tasks/{id}/run", endpoint(func(_ http.ResponseWriter, r *http.Request) (any, error) {
		return s.run(r.Context(), r.PathValue("id"))
	}))
}
