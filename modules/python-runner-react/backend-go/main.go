package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"
)

func moduleHandler(c config, routes http.Handler, shutdown func()) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health/ready", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"ready": true, "module_id": c.moduleID, "release_id": c.releaseID,
		})
	})
	mux.HandleFunc("POST /health/shutdown", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
		shutdown()
	})
	mux.Handle("/", routes)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-ToolNest-Internal-Token")), []byte(c.token)) != 1 {
			writeJSON(w, http.StatusUnauthorized, map[string]any{
				"code": http.StatusUnauthorized, "message": "module authentication required", "data": nil,
			})
			return
		}
		mux.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		log.Printf("write response: %v", err)
	}
}

func run(ctx context.Context, c config) error {
	ctx, stop := context.WithCancel(ctx)
	defer stop()
	if err := prepareDirectories(c); err != nil {
		return err
	}
	startup, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	pool, err := openDatabase(startup, c)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := recoverInterruptedExecutions(startup, pool); err != nil {
		return err
	}
	listener, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(c.port)))
	if err != nil {
		return err
	}
	defer listener.Close()

	routes := http.NewServeMux()
	registerSecurityRoutes(routes)
	projects := &projectService{config: c, db: pool}
	registerProjectRoutes(routes, projects)
	registerProjectFileRoutes(routes, projects)
	registerEnvironmentRoutes(routes, projects)
	executionService := &executions{
		config: c, db: pool, notify: newNotifier(c, os.Getenv("TOOLNEST_PLUGIN_PLATFORM_API_URL")),
		running:        make(map[string]context.CancelFunc),
		prepareArchive: projects.prepareExecution,
	}
	registerExecutionRoutes(routes, executionService)
	schedules := &scheduleService{db: pool, executions: executionService, projects: projects}
	registerScheduleRoutes(routes, schedules)
	registerOverviewRoutes(routes, pool, executionService, schedules)
	persistent := &persistentService{
		config: c, db: pool, projects: projects, notify: executionService.notify,
		active: make(map[string]*persistentProcess), restarts: make(map[string]*time.Timer),
	}
	registerPersistentRoutes(routes, persistent)
	registerStorageRoutes(routes, projects, persistent)
	persistentContext, cancelPersistent := context.WithCancel(ctx)
	defer cancelPersistent()
	if err := persistent.initialize(persistentContext); err != nil {
		return err
	}
	defer func() {
		cancelPersistent()
		persistent.close()
	}()
	stopScheduler := schedules.start(ctx, 15*time.Second)
	defer func() {
		executionService.close()
		stopScheduler()
	}()
	server := &http.Server{
		Handler: moduleHandler(c, routes, stop), ReadHeaderTimeout: 5 * time.Second,
		BaseContext: func(net.Listener) context.Context { return ctx },
	}
	stopped := make(chan error, 1)
	go func() { stopped <- server.Serve(listener) }()
	select {
	case err := <-stopped:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	case <-ctx.Done():
		go executionService.close()
		shutdown, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdown); err != nil {
			_ = server.Close()
			return fmt.Errorf("shut down HTTP server: %w", err)
		}
		return nil
	}
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	c, err := loadConfig(os.Getenv)
	if err == nil {
		switch {
		case len(os.Args) == 1:
			err = run(ctx, c)
		case len(os.Args) == 2 && os.Args[1] == "--recover-python-environments":
			err = recoverPythonEnvironments(ctx, c)
		default:
			err = fmt.Errorf("unrecognized Python Runner command")
		}
	}
	if err != nil {
		log.Fatal(err)
	}
}
