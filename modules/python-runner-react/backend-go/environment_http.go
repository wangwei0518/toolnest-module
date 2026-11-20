package main

import (
	"net/http"
	"strings"
)

func registerEnvironmentRoutes(routes *http.ServeMux, s *projectService) {
	wrap := func(update bool, action func(http.ResponseWriter, *http.Request, project) (any, error)) endpoint {
		return func(w http.ResponseWriter, r *http.Request) (any, error) {
			if update {
				s.mutations.Lock()
				defer s.mutations.Unlock()
			}
			p, err := s.get(r.Context(), r.PathValue("id"))
			if err != nil {
				return nil, err
			}
			return action(w, r, p)
		}
	}
	environment := func(_ http.ResponseWriter, r *http.Request, p project) (any, error) {
		return s.environment(r.Context(), p)
	}
	routes.Handle("GET /uploads/{id}/environment", wrap(false, environment))
	routes.Handle("POST /uploads/{id}/environment/create", wrap(true, func(w http.ResponseWriter, r *http.Request, p project) (any, error) {
		if err := s.createEnvironment(r.Context(), p); err != nil {
			return nil, err
		}
		return environment(w, r, p)
	}))
	routes.Handle("POST /uploads/{id}/environment/install-requirements", wrap(true, func(w http.ResponseWriter, r *http.Request, p project) (any, error) {
		var input struct {
			Confirmed bool   `json:"confirm_risk"`
			Scan      string `json:"scan_id"`
		}
		if r.ContentLength != 0 {
			if err := readJSON(w, r, &input); err != nil {
				return nil, err
			}
		}
		if err := s.installRequirements(r.Context(), p, securityConfirmation{ID: input.Scan, Confirmed: input.Confirmed}); err != nil {
			return nil, err
		}
		return environment(w, r, p)
	}))
	routes.Handle("DELETE /uploads/{id}/environment", wrap(true, func(w http.ResponseWriter, r *http.Request, p project) (any, error) {
		if err := s.deleteEnvironment(r.Context(), p); err != nil {
			return nil, err
		}
		return environment(w, r, p)
	}))
	routes.Handle("POST /uploads/{id}/environment/rebuild", wrap(true, func(w http.ResponseWriter, r *http.Request, p project) (any, error) {
		if err := s.deleteEnvironment(r.Context(), p); err != nil {
			return nil, err
		}
		if err := s.createEnvironment(r.Context(), p); err != nil {
			return nil, err
		}
		return environment(w, r, p)
	}))
	routes.Handle("GET /uploads/{id}/environment/install-log", wrap(false, func(_ http.ResponseWriter, _ *http.Request, p project) (any, error) {
		content, truncated, err := readTail(s.installLogPath(p), installLogLimit)
		return map[string]any{"content": content, "truncated": truncated || strings.HasSuffix(content, installLogMarker)}, err
	}))
	routes.Handle("DELETE /uploads/{id}/data", wrap(true, func(w http.ResponseWriter, r *http.Request, p project) (any, error) {
		if err := s.removeProjectDirectory(p, "data"); err != nil {
			return nil, err
		}
		return environment(w, r, p)
	}))
}
