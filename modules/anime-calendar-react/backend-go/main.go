package main

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	_ "time/tzdata"
)

type config struct {
	id, release, token, platform, dataDir, logDir, dsn, schema string
	port, poolMax, parentPID                                   int
}

func loadConfig() (config, error) {
	value := func(name string) string { return os.Getenv("TOOLNEST_PLUGIN_" + name) }
	cfg := config{
		id: value("ID"), release: value("RELEASE_ID"), token: value("TOKEN"),
		platform: value("PLATFORM_API_URL"), dataDir: value("DATA_DIR"), logDir: value("LOG_DIR"),
		dsn: value("DATABASE_URL"), schema: firstText(value("DATABASE_SCHEMA"), "public"),
	}
	for _, item := range []struct{ name, value string }{
		{"ID", cfg.id}, {"RELEASE_ID", cfg.release}, {"TOKEN", cfg.token},
		{"DATA_DIR", cfg.dataDir}, {"LOG_DIR", cfg.logDir}, {"DATABASE_URL", cfg.dsn},
	} {
		if item.value == "" {
			return cfg, fmt.Errorf("TOOLNEST_PLUGIN_%s is required", item.name)
		}
	}
	for _, item := range []struct {
		name               string
		target             *int
		fallback, min, max int
	}{
		{"PORT", &cfg.port, 0, 0, 65535}, {"DATABASE_POOL_MAX", &cfg.poolMax, 2, 1, 16},
		{"PARENT_PID", &cfg.parentPID, 0, 0, 1<<31 - 1},
	} {
		v := item.fallback
		if raw := value(item.name); raw != "" {
			var err error
			v, err = strconv.Atoi(raw)
			if err != nil || v < item.min || v > item.max {
				return cfg, fmt.Errorf("invalid TOOLNEST_PLUGIN_%s", item.name)
			}
		}
		*item.target = v
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
		if err := os.MkdirAll(dir, 0o750); err != nil {
			return err
		}
	}
	initCtx, cancelInit := context.WithTimeout(ctx, 12*time.Second)
	store, err := openStore(initCtx, cfg.dsn, cfg.schema, cfg.dataDir, int32(cfg.poolMax), time.Now)
	cancelInit()
	if err != nil {
		return err
	}
	defer store.pool.Close()
	zone, err := time.LoadLocation(os.Getenv("TOOLNEST_TIMEZONE"))
	if err != nil || os.Getenv("TOOLNEST_TIMEZONE") == "" {
		zone, _ = time.LoadLocation("Asia/Shanghai")
	}
	platform := newPlatformClient(cfg.platform, cfg.id, cfg.token, zone)
	const upstream = "https://api.bgm.tv"
	probe := func(cfg settings) (animeProvider, error) {
		return newBangumi(upstream, proxyAddress(cfg), time.Now)
	}
	svc := &service{store: store, now: time.Now, zone: zone}
	var providerMu sync.Mutex
	var client *bangumi
	var proxy string
	svc.provider = func() (animeProvider, error) {
		providerMu.Lock()
		defer providerMu.Unlock()
		settings, err := svc.settings()
		if err != nil {
			return nil, err
		}
		address := proxyAddress(settings)
		if client == nil || proxy != address {
			next, err := newBangumi(upstream, address, time.Now)
			if err != nil {
				return nil, err
			}
			if client != nil {
				client.client.CloseIdleConnections()
			}
			client, proxy = next, address
		}
		return client, nil
	}
	notify := notifications{svc, platform}
	schedule := scheduler{svc, platform, make(map[string]time.Time)}
	api := httpAPI{cfg.id, cfg.release, cfg.token, svc, notify, probe}
	listener, err := net.Listen("tcp4", fmt.Sprintf("127.0.0.1:%d", cfg.port))
	if err != nil {
		return err
	}
	workerCtx, stop := context.WithCancel(ctx)
	var workers sync.WaitGroup
	defer func() {
		stop()
		workers.Wait()
	}()
	handler := api.handler()
	server := &http.Server{
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost || r.URL.Path != "/health/shutdown" {
				handler.ServeHTTP(w, r)
				return
			}
			if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Toolnest-Internal-Token")), []byte(cfg.token)) != 1 {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			_ = http.NewResponseController(w).Flush()
			stop()
		}), ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout: 10 * time.Second, IdleTimeout: 30 * time.Second,
		BaseContext: func(net.Listener) context.Context { return workerCtx },
	}
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()
	workers.Go(func() { runEveryMinute(workerCtx, true, schedule.refresh) })
	workers.Go(func() { runEveryMinute(workerCtx, false, notify.run) })
	select {
	case err := <-done:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-workerCtx.Done():
		stop()
		shutdown, cancel := context.WithTimeout(context.Background(), 12*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdown); err != nil {
			_ = server.Close()
			return err
		}
	}
	return nil
}

func proxyAddress(cfg settings) string {
	if cfg.Proxy.Enabled {
		return strings.TrimSpace(cfg.Proxy.URL)
	}
	return ""
}

func watchParent(ctx context.Context, pid int, cancel context.CancelFunc) {
	if pid == 0 {
		return
	}
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			if !parentAlive(pid) {
				cancel()
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
