package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"sync"
	"syscall"
	"time"
)

type config struct {
	id, release, token, platform, dataDir, logDir string
	databaseURL, schema                           string
	port, parentPID, poolSize                     int
	history                                       historyLimits
}

func loadConfig() (config, error) {
	env := func(name string) string { return os.Getenv("TOOLNEST_PLUGIN_" + name) }
	cfg := config{
		id: env("ID"), release: env("RELEASE_ID"), token: env("TOKEN"), platform: env("PLATFORM_API_URL"),
		dataDir: env("DATA_DIR"), logDir: env("LOG_DIR"), databaseURL: env("DATABASE_URL"),
		schema: stringOr(env("DATABASE_SCHEMA"), "public"),
	}
	for _, item := range []struct{ name, value string }{
		{"ID", cfg.id}, {"RELEASE_ID", cfg.release}, {"TOKEN", cfg.token}, {"DATA_DIR", cfg.dataDir},
		{"LOG_DIR", cfg.logDir}, {"DATABASE_URL", cfg.databaseURL},
	} {
		if item.value == "" {
			return cfg, fmt.Errorf("TOOLNEST_PLUGIN_%s is required", item.name)
		}
	}
	for _, item := range []struct {
		name                       string
		target                     *int
		fallback, minimum, maximum int
	}{
		{"TOOLNEST_PLUGIN_PORT", &cfg.port, 0, 0, 65535},
		{"TOOLNEST_PLUGIN_PARENT_PID", &cfg.parentPID, 0, 0, 1<<31 - 1},
		{"TOOLNEST_PLUGIN_DATABASE_POOL_MAX", &cfg.poolSize, 2, 1, 16},
		{"TOOLNEST_WORKFLOW_TIMELINE_HISTORY_MAX", &cfg.history.timeline, 5000, 100, 100000},
		{"TOOLNEST_WORKFLOW_ACTION_HISTORY_MAX", &cfg.history.actionExecutions, 2000, 100, 100000},
		{"TOOLNEST_WORKFLOW_SCHEDULE_RUN_HISTORY_MAX", &cfg.history.scheduleRuns, 2000, 100, 100000},
	} {
		*item.target = item.fallback
		if raw := os.Getenv(item.name); raw != "" {
			value, err := strconv.Atoi(raw)
			if err != nil || value < item.minimum || value > item.maximum {
				return cfg, fmt.Errorf("%s must be an integer between %d and %d", item.name, item.minimum, item.maximum)
			}
			*item.target = value
		}
	}
	var err error
	if cfg.dataDir, err = filepath.Abs(cfg.dataDir); err != nil {
		return cfg, err
	}
	cfg.logDir, err = filepath.Abs(cfg.logDir)
	return cfg, err
}

func main() {
	cfg, err := loadConfig()
	if err != nil {
		log.Fatal(err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	watchParent(ctx, cfg.parentPID, stop)
	if err := run(ctx, cfg); err != nil {
		log.Fatal(err)
	}
}

func run(ctx context.Context, cfg config) error {
	for _, directory := range []string{cfg.dataDir, cfg.logDir} {
		if err := os.MkdirAll(directory, 0750); err != nil {
			return err
		}
	}
	ready, cancel := context.WithTimeout(ctx, 12*time.Second)
	repo, err := openRepository(ready, cfg.databaseURL, cfg.schema, cfg.dataDir, int32(cfg.poolSize), cfg.history)
	if err != nil {
		cancel()
		return err
	}
	defer repo.pool.Close()
	repo.notifier = platformNotifications{base: cfg.platform, token: cfg.token, moduleID: cfg.id}
	err = repo.update(ready, func(state *workflowState) error {
		if len(state.entities["workflows"]) == 0 {
			state.entities["workflows"] = []record{
				defaultWorkflow("通用任务流程", "用于记录准备、处理和确认的通用流程。", "通用", timestamp(time.Now()), true),
			}
		}
		return nil
	})
	cancel()
	if err != nil {
		return err
	}
	listener, err := net.Listen("tcp4", fmt.Sprintf("127.0.0.1:%d", cfg.port))
	if err != nil {
		return err
	}
	defer listener.Close()
	shutdown := make(chan struct{})
	var once sync.Once
	server := &http.Server{
		Handler:           newAPI(cfg, repo, func() { once.Do(func() { close(shutdown) }) }),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       30 * time.Second,
		MaxHeaderBytes:    32 << 10,
	}
	serveDone := make(chan error, 1)
	workerCtx, stopWorker := context.WithCancel(ctx)
	workerDone := make(chan struct{})
	go func() {
		defer close(workerDone)
		scheduleWorker(workerCtx, repo)
	}()
	defer func() { stopWorker(); <-workerDone }()
	go func() { serveDone <- server.Serve(listener) }()
	select {
	case err := <-serveDone:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
	case <-shutdown:
	}
	stopWorker()
	drain, end := context.WithTimeout(context.Background(), 15*time.Second)
	defer end()
	if err := server.Shutdown(drain); err != nil {
		_ = server.Close()
		return err
	}
	return nil
}

func watchParent(ctx context.Context, pid int, stop context.CancelFunc) {
	if pid == 0 {
		return
	}
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			if !parentAlive(pid) {
				stop()
				return
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}
