package main

import (
	"net/http"
	"os"
)

func registerProjectRoutes(routes *http.ServeMux, s *projectService) {
	routes.Handle("GET /projects", endpoint(func(_ http.ResponseWriter, r *http.Request) (any, error) {
		return s.summaries(r.Context())
	}))
	routes.Handle("GET /uploads", endpoint(func(_ http.ResponseWriter, r *http.Request) (any, error) {
		var status *string
		if r.URL.Query().Has("status") {
			value := r.URL.Query().Get("status")
			status = &value
		}
		return s.list(r.Context(), status)
	}))
	routes.Handle("POST /uploads/archive", endpoint(func(w http.ResponseWriter, r *http.Request) (any, error) {
		upload, err := readMultipartArchive(w, r, s.config.dataDir)
		if err != nil {
			return nil, err
		}
		defer os.Remove(upload.temporaryPath)
		return s.create(r.Context(), upload)
	}))
	routes.Handle("GET /uploads/{id}", endpoint(func(_ http.ResponseWriter, r *http.Request) (any, error) {
		p, err := s.get(r.Context(), r.PathValue("id"))
		return p.upload(), err
	}))
	routes.Handle("DELETE /uploads/{id}", endpoint(func(_ http.ResponseWriter, r *http.Request) (any, error) {
		s.mutations.Lock()
		defer s.mutations.Unlock()
		return nil, s.remove(r.Context(), r.PathValue("id"))
	}))
	routes.Handle("POST /uploads/{id}/update", endpoint(func(w http.ResponseWriter, r *http.Request) (any, error) {
		upload, err := readMultipartArchive(w, r, s.config.dataDir)
		if err != nil {
			return nil, err
		}
		defer os.Remove(upload.temporaryPath)
		return s.update(r.Context(), r.PathValue("id"), upload)
	}))
	routes.Handle("POST /uploads/{id}/rollback", endpoint(func(w http.ResponseWriter, r *http.Request) (any, error) {
		var input struct {
			Confirm bool `json:"confirm_schedule_impact"`
		}
		if r.ContentLength != 0 {
			if err := readJSON(w, r, &input); err != nil {
				return nil, err
			}
		}
		return s.rollback(r.Context(), r.PathValue("id"), input.Confirm)
	}))
	scan := func(refresh bool, onlyFindings bool) endpoint {
		return func(_ http.ResponseWriter, r *http.Request) (any, error) {
			p, err := s.get(r.Context(), r.PathValue("id"))
			if err != nil {
				return nil, err
			}
			result, err := s.projectScan(r.Context(), p, refresh)
			if onlyFindings {
				return result.Findings, err
			}
			return result, err
		}
	}
	routes.Handle("GET /uploads/{id}/security", scan(false, false))
	routes.Handle("GET /uploads/{id}/security/findings", scan(false, true))
	routes.Handle("POST /uploads/{id}/security/scan", scan(true, false))
}
