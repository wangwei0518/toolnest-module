package main

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

type readOnlyStore struct{ state *state }

func (store readOnlyStore) read() *state { return store.state }
func (store readOnlyStore) update(context.Context, func(*state) error) error {
	panic("unexpected write during cached read")
}

func TestCachedCourAndTodayIncludeFollowedLongRunner(t *testing.T) {
	now := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
	episodeCount := 1191
	item := animeItem{listItem: listItem{
		ID: "bangumi:975", TitleCN: "航海王", AirDate: nullable("1999-10-20"),
		MediaType: "tv", Status: "airing", EpisodeCount: &episodeCount, Weekday: isoWeekday(now),
	}}
	store := readOnlyStore{&state{
		Marks:  map[string]string{item.ID: "watching"},
		Weekly: &dataCache{Date: now.Format(dateLayout), Items: []animeItem{item}},
		Today:  &dataCache{Date: now.Format(dateLayout), Items: []animeItem{item}},
	}}
	svc := service{store: store, now: func() time.Time { return now }, zone: time.UTC}
	courResult := svc.list(itemQuery{Cour: courAt(now), Mark: "watching"})
	items := courResult["items"].([]listItem)
	if len(items) != 1 || items[0].CourRelation != "long_running" || *items[0].MarkType != "watching" {
		t.Fatalf("unexpected followed list: %v", items)
	}
	todayResult, err := svc.today(context.Background(), time.UTC)
	if err != nil || todayResult["total"] != 1 {
		t.Fatalf("unexpected today response: %v, %v", todayResult, err)
	}
	if count := svc.stats(courAt(now))["watching"]; count != 1 {
		t.Fatalf("stats watching = %v, want 1", count)
	}
}

func TestSettingsTemplateValidationAndDefaults(t *testing.T) {
	raw := json.RawMessage(`{"proxy":{"enabled":true,"url":"socks5h://127.0.0.1:1080"},"notifications":{"courRelease":{"titleTemplate":"{unknown_variable}"}}}`)
	settings, err := decodeSettings(raw)
	if err != nil {
		t.Fatal(err)
	}
	if settings.DataRefreshTime != "04:00" || settings.Notifications.Watching.DeliveryMode != "digest" {
		t.Fatalf("defaults did not survive partial settings: %v", settings)
	}
	if err := settings.validate(); err == nil || !strings.Contains(err.Error(), "{unknown_variable}") {
		t.Fatalf("invalid template error = %v", err)
	}
	settings.Notifications.Cour.TitleTemplate = "{year}"
	if err := settings.validate(); err != nil {
		t.Fatal(err)
	}
}
