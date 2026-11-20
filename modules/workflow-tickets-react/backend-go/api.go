package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
)

type stateRepository interface {
	read(context.Context, func(*workflowState) error) error
	update(context.Context, func(*workflowState) error) error
}

type api struct {
	repo     stateRepository
	moduleID string
	dataDir  string
	notifier platformNotifications
}

type action func(*workflowState, *http.Request, record) (any, error)

func newAPI(cfg config, repo stateRepository, shutdown func()) http.Handler {
	app := &api{repo: repo, moduleID: cfg.id, dataDir: cfg.dataDir, notifier: platformNotifications{base: cfg.platform, token: cfg.token, moduleID: cfg.id}}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health/ready", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, record{"ready": true, "module_id": cfg.id, "release_id": cfg.release})
	})
	mux.HandleFunc("POST /health/shutdown", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
		_ = http.NewResponseController(w).Flush()
		shutdown()
	})
	mux.HandleFunc("GET /hello", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, record{"message": "工单模板 模块已连接。"})
	})
	app.registerWorkflows(mux)
	app.registerTickets(mux)
	app.registerSchedules(mux)
	app.registerProjects(mux)
	app.registerScheduleItems(mux)
	app.registerAttachments(mux)
	app.registerActivity(mux)
	app.registerSavedViews(mux)
	app.registerResources(mux)
	app.registerSettings(mux)
	app.registerData(mux)
	app.registerAutomations(mux)
	app.registerActionProviders(mux)
	mux.HandleFunc("GET /temp/{token}", app.serveTemporaryResource)
	return http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		public := request.Method == http.MethodGet && strings.HasPrefix(request.URL.Path, "/temp/")
		if !public && (cfg.token == "" || subtle.ConstantTimeCompare([]byte(request.Header.Get("X-ToolNest-Internal-Token")), []byte(cfg.token)) != 1) {
			writeError(w, failure(401, "module authentication required"))
			return
		}
		mux.ServeHTTP(w, request)
	})
}

func (app *api) endpoint(mux *http.ServeMux, pattern string, write bool, operation action) {
	mux.HandleFunc(pattern, func(w http.ResponseWriter, request *http.Request) {
		body, err := readBody(w, request)
		if err != nil {
			writeError(w, err)
			return
		}
		var result any
		var responseErr error
		transaction := app.repo.read
		if write {
			transaction = app.repo.update
		}
		err = transaction(request.Context(), func(state *workflowState) error {
			var err error
			result, err = operation(state, request, body)
			var persist *committedFailure
			if write && errors.As(err, &persist) {
				responseErr = persist.cause
				return nil
			}
			return err
		})
		if err != nil {
			writeError(w, err)
			return
		}
		if responseErr != nil {
			writeError(w, responseErr)
			return
		}
		if result == nil {
			writeJSON(w, 200, record{})
			return
		}
		writeJSON(w, 200, record{"data": result})
	})
}

type committedFailure struct{ cause error }

func (err *committedFailure) Error() string { return err.cause.Error() }

func readBody(w http.ResponseWriter, request *http.Request) (record, error) {
	if request.Method != http.MethodPost && request.Method != http.MethodPut && request.Method != http.MethodPatch {
		return record{}, nil
	}
	return readJSONBody(w, request, 1<<20)
}

func readJSONBody(w http.ResponseWriter, request *http.Request, limit int64) (record, error) {
	request.Body = http.MaxBytesReader(w, request.Body, limit)
	decoder := json.NewDecoder(request.Body)
	decoder.UseNumber()
	var value any
	err := decoder.Decode(&value)
	if errors.Is(err, io.EOF) {
		return record{}, nil
	}
	if err == nil {
		trailing := decoder.Decode(new(any))
		if !errors.Is(trailing, io.EOF) {
			err = trailing
			if err == nil {
				err = errors.New("unexpected content after request JSON")
			}
		}
	}
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return nil, failure(413, "请求内容过大")
		}
		return nil, failure(400, "请求 JSON 格式无效")
	}
	return objectOrEmpty(value), nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, err error) {
	var domain *domainError
	if !errors.As(err, &domain) {
		log.Printf("workflow request error (%T)", err)
		domain = &domainError{status: 500, message: "工单服务暂时不可用"}
	}
	writeJSON(w, domain.status, record{"code": domain.status, "message": domain.message, "data": nil})
}

func (app *api) registerWorkflows(mux *http.ServeMux) {
	app.endpoint(mux, "GET /workflows", false, func(state *workflowState, request *http.Request, _ record) (any, error) {
		return state.listWorkflows(stringValue(request.URL.Query().Get("keyword"))), nil
	})
	app.endpoint(mux, "POST /workflows", true, func(state *workflowState, _ *http.Request, body record) (any, error) {
		return state.createWorkflow(body, timestamp(time.Now()))
	})
	for _, route := range []struct {
		pattern string
		write   bool
		handle  func(*workflowState, record, *http.Request, record) (any, error)
	}{
		{"GET /workflows/{workflowID}", false, func(state *workflowState, workflow record, _ *http.Request, _ record) (any, error) {
			return workflowRead(workflow, state.versionUsage()), nil
		}},
		{"PUT /workflows/{workflowID}", true, func(state *workflowState, workflow record, _ *http.Request, body record) (any, error) {
			return state.updateWorkflow(workflow, body, timestamp(time.Now()))
		}},
		{"POST /workflows/{workflowID}/archive", true, func(state *workflowState, workflow record, _ *http.Request, _ record) (any, error) {
			return state.archiveWorkflow(workflow, timestamp(time.Now())), nil
		}},
		{"POST /workflows/{workflowID}/versions", true, func(state *workflowState, workflow record, _ *http.Request, body record) (any, error) {
			return state.createVersion(workflow, body, timestamp(time.Now()))
		}},
		{"POST /workflows/{workflowID}/publish", true, func(state *workflowState, workflow record, _ *http.Request, body record) (any, error) {
			return state.publishWorkflow(workflow, body, timestamp(time.Now()))
		}},
		{"GET /workflows/{workflowID}/versions/compare", false, func(_ *workflowState, workflow record, request *http.Request, _ record) (any, error) {
			query := request.URL.Query()
			return compareVersions(workflow, query.Get("base_version_id"), query.Get("target_version_id"))
		}},
		{"POST /workflows/{workflowID}/dry-run", false, func(_ *workflowState, workflow record, _ *http.Request, body record) (any, error) {
			return dryRun(workflow, body)
		}},
	} {
		app.endpoint(mux, route.pattern, route.write, func(state *workflowState, request *http.Request, body record) (any, error) {
			workflow, err := state.workflow(request.PathValue("workflowID"))
			if err != nil {
				return nil, err
			}
			return route.handle(state, workflow, request, body)
		})
	}
}
