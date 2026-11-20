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
	"sync"
	"syscall"
	"time"
)

type config struct {
	id, release, token, platform, dataDir, logDir string
	port, parentPID                               int
}

func loadConfig() (config, error) {
	env := func(key string) string { return os.Getenv("TOOLNEST_PLUGIN_" + key) }
	cfg := config{id: env("ID"), release: env("RELEASE_ID"), token: env("TOKEN"), platform: env("PLATFORM_API_URL"), dataDir: env("DATA_DIR"), logDir: env("LOG_DIR")}
	for _, item := range []struct{ name, value string }{
		{"ID", cfg.id}, {"RELEASE_ID", cfg.release}, {"TOKEN", cfg.token}, {"DATA_DIR", cfg.dataDir}, {"LOG_DIR", cfg.logDir},
	} {
		if item.value == "" {
			return cfg, fmt.Errorf("TOOLNEST_PLUGIN_%s is required", item.name)
		}
	}
	for _, item := range []struct {
		name   string
		target *int
		max    int
	}{
		{"PORT", &cfg.port, 65535}, {"PARENT_PID", &cfg.parentPID, 1<<31 - 1},
	} {
		if raw := env(item.name); raw != "" {
			n, err := strconv.Atoi(raw)
			if err != nil || n < 0 || n > item.max {
				return cfg, fmt.Errorf("invalid TOOLNEST_PLUGIN_%s", item.name)
			}
			*item.target = n
		}
	}
	return cfg, nil
}

func main() {
	cfg, err := loadConfig()
	if err != nil {
		log.Fatal(err)
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	watchParent(ctx, cfg.parentPID, cancel)
	if err := run(ctx, cfg); err != nil {
		log.Fatal(err)
	}
}

func run(ctx context.Context, cfg config) error {
	for _, dir := range []string{cfg.dataDir, cfg.logDir} {
		if err := os.MkdirAll(dir, 0750); err != nil {
			return err
		}
	}
	initCtx, cancelInit := context.WithTimeout(ctx, 12*time.Second)
	store, err := openStore(initCtx, cfg.dataDir)
	cancelInit()
	if err != nil {
		return err
	}
	defer store.db.Close()
	api, err := newAPI(cfg, store)
	if err != nil {
		return err
	}
	listener, err := net.Listen("tcp4", fmt.Sprintf("127.0.0.1:%d", cfg.port))
	if err != nil {
		return err
	}
	defer listener.Close()
	shutdownRequested := make(chan struct{})
	var requestShutdown sync.Once
	server := &http.Server{
		Handler:           authenticated(cfg, api.handler(), func() { requestShutdown.Do(func() { close(shutdownRequested) }) }),
		ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 180 * time.Second,
		IdleTimeout: 30 * time.Second, MaxHeaderBytes: 32 << 10,
	}
	workerCtx, stop := context.WithCancel(ctx)
	cleanupDone := make(chan struct{})
	go func() {
		defer close(cleanupDone)
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			if err := api.cleanup(workerCtx); err != nil && workerCtx.Err() == nil {
				log.Printf("文件邮局清理任务失败 (%T)，稍后重试", err)
			}
			select {
			case <-workerCtx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
	defer func() { stop(); <-cleanupDone }()
	serveDone := make(chan error, 1)
	go func() { serveDone <- server.Serve(listener) }()
	select {
	case err = <-serveDone:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
	case <-shutdownRequested:
	}
	stop()
	drainCtx, endDrain := context.WithTimeout(context.Background(), 15*time.Second)
	defer endDrain()
	if err := server.Shutdown(drainCtx); err != nil {
		_ = server.Close()
		return err
	}
	return nil
}

func authenticated(cfg config, next http.Handler, shutdown func()) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health/ready", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{"ready": true, "module_id": cfg.id, "release_id": cfg.release})
	})
	mux.HandleFunc("POST /health/shutdown", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
		_ = http.NewResponseController(w).Flush()
		shutdown()
	})
	mux.Handle("/", next)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if cfg.token == "" || subtle.ConstantTimeCompare([]byte(r.Header.Get("X-ToolNest-Internal-Token")), []byte(cfg.token)) != 1 {
			writeJSON(w, 401, map[string]any{"code": 401, "message": "module authentication required", "data": nil})
			return
		}
		mux.ServeHTTP(w, r)
	})
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

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
