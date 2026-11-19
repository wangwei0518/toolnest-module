package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type fixtureStore struct{ snapshot *state }

func (f fixtureStore) read() *state { return f.snapshot }
func (f fixtureStore) update(_ context.Context, mutate func(*state) error) error {
	return mutate(f.snapshot)
}

type fixtureProvider struct {
	cours       []cour
	weeklyCalls int
	detailCalls int
	detail      animeItem
}

func (p *fixtureProvider) fetchCour(_ context.Context, c cour) ([]animeItem, error) {
	p.cours = append(p.cours, c)
	return nil, nil
}

func (p *fixtureProvider) fetchWeekly(context.Context) ([]animeItem, error) {
	p.weeklyCalls++
	return nil, nil
}

func (p *fixtureProvider) fetchDetail(context.Context, string) (animeItem, error) {
	p.detailCalls++
	return p.detail, nil
}

func runtimeFixture(now func() time.Time) (*service, *fixtureProvider) {
	snapshot := new(state)
	snapshot.normalize(now())
	p := &fixtureProvider{}
	svc := &service{
		store: fixtureStore{snapshot}, now: now, zone: time.UTC,
		provider: func() (animeProvider, error) { return p, nil },
	}
	return svc, p
}

func TestRuntimeHTTPAuthenticationAndContracts(t *testing.T) {
	now := func() time.Time { return time.Date(2026, 10, 21, 4, 0, 0, 0, time.UTC) }
	svc, provider := runtimeFixture(now)
	svc.store.read().Items = append(svc.store.read().Items, animeItem{listItem: listItem{
		ID: "bangumi:1", AirDate: nullable("2026-10-21"), TitleCN: "测试番剧",
	}})
	provider.detail = animeItem{Summary: "详情简介"}
	p := newPlatformClient("", "anime-calendar-react", "fixture-token", time.UTC)
	handler := httpAPI{"anime-calendar-react", "fixture-release", "fixture-token", svc, notifications{svc, p},
		func(settings) (animeProvider, error) { return provider, nil }}.handler()
	for _, tc := range []struct {
		method, path, body, match string
		code                      int
	}{
		{"GET", "/health/ready", "", `"release_id":"fixture-release"`, 200},
		{"GET", "/cour/current", "", `"cour_month":10`, 200},
		{"GET", "/items?weekday=invalid", "", `"code":400`, 400},
		{"POST", "/items/bangumi:1/mark", `{"mark_type":"watching"}`, `"mark_type":"watching"`, 200},
		{"GET", "/items?mark_type=watching", "", `"total":1`, 200},
		{"GET", "/items/bangumi%3A1", "", `"summary":"详情简介"`, 200},
		{"GET", "/items/bangumi%3A1", "", `"mark_type":"watching"`, 200},
		{"DELETE", "/items/bangumi:1/mark", "", `"mark_type":null`, 200},
		{"GET", "/stats", "", `"watching":0`, 200},
		{"GET", "/weekly", "", `"total":0`, 200},
		{"GET", "/today", "", `"items":[]`, 200},
		{"PUT", "/calendar-settings", `{"dataRefreshTime":"06:00"}`, `"dataRefreshTime":"06:00"`, 200},
		{"POST", "/connection-test", "", `"ok":true`, 200},
		{"POST", "/refresh", `{"year":2026,"cour_month":10,"force":true}`, `"cache_status":"empty"`, 200},
		{"POST", "/long-running/refresh", "", `"retained_count":0`, 200},
		{"POST", "/notifications/test-cour-release", "", `"ok":false`, 200},
		{"POST", "/notifications/test-watching-update", "", `"ok":false`, 200},
	} {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			request := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			request.Header.Set(internalTokenHeader, "fixture-token")
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != tc.code || !strings.Contains(response.Body.String(), tc.match) {
				t.Fatalf("status %d body %s", response.Code, response.Body.String())
			}
		})
	}
	if provider.detailCalls != 1 {
		t.Fatalf("detail requests to upstream = %d, want 1", provider.detailCalls)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/health/ready", nil))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated readiness status = %d", response.Code)
	}
}

func TestScheduledRefreshAndNotificationUsePlatformTimezone(t *testing.T) {
	now := time.Date(2026, 9, 30, 19, 59, 0, 0, time.UTC)
	svc, provider := runtimeFixture(func() time.Time { return now })
	var sent []map[string]any
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get(internalTokenHeader) != "fixture-token" {
			t.Error("missing internal token")
		}
		switch r.URL.Path {
		case "/internal/modules/anime-calendar-react/platform-context":
			_, _ = w.Write([]byte(`{"data":{"timezone":"Asia/Shanghai","public_base_url":"https://example.test/"}}`))
		case "/internal/modules/anime-calendar-react/notifications":
			var notice map[string]any
			if err := json.NewDecoder(r.Body).Decode(&notice); err != nil {
				t.Error(err)
			}
			sent = append(sent, notice)
			_, _ = w.Write([]byte(`{"notification_id":"n1","deliveries":[]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer host.Close()
	platform := newPlatformClient(host.URL, "anime-calendar-react", "fixture-token", time.UTC)
	scheduled := scheduler{svc, platform, make(map[string]time.Time)}
	ctx := context.Background()
	if err := scheduled.refresh(ctx); err != nil || len(provider.cours) != 0 {
		t.Fatalf("ran before 04:00 in platform timezone: %v, %v", provider.cours, err)
	}
	now = now.Add(time.Minute)
	for range 2 {
		if err := scheduled.refresh(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if len(provider.cours) != 2 || provider.cours[0] != (cour{2026, 10}) ||
		provider.cours[1] != (cour{2027, 1}) || provider.weeklyCalls != 1 {
		t.Fatalf("unexpected scheduled calls: %v, %d", provider.cours, provider.weeklyCalls)
	}
	state := svc.store.read()
	state.Settings = json.RawMessage(`{"notifications":{"courRelease":{"enabled":true,"sendTime":"04:00","minimumCount":0,"bodyTemplate":"{module_url}"}}}`)
	n := notifications{svc, platform}
	for range 2 {
		if err := n.run(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if len(sent) != 1 || sent[0]["content"] != "https://example.test/modules/anime-calendar-react" {
		t.Fatalf("unexpected notifications: %v", sent)
	}
	if _, explicit := sent[0]["channels"]; explicit {
		t.Fatal("default-channel notification overrides host configuration")
	}
	if got := state.Notifications["cour-release:2026:10:default"].NotificationID; got == nil || *got != "n1" {
		t.Fatalf("notification history missing: %v", state.Notifications)
	}
}
