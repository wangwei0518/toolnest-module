package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"
)

func TestCourClassification(t *testing.T) {
	current := cour{2026, 10}
	old, july := "1999-10-20", "2026-07-03"
	twelve, twentyFour, onePiece := 12, 24, 1191
	for _, tc := range []struct {
		name     string
		airDate  string
		episodes *int
		active   bool
		want     string
	}{
		{"known single cour", july, &twelve, true, "unknown"},
		{"half year airing", july, &twentyFour, true, "continuing"},
		{"uncounted active TV", old, nil, true, "long_running"},
		{"One Piece cumulative count", old, &onePiece, true, "long_running"},
		{"no weekly airing evidence", old, &onePiece, false, "unknown"},
		{"last day of current cour", "2026-12-31", &twelve, false, "new_this_cour"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			item := animeItem{listItem: listItem{
				AirDate: &tc.airDate, EpisodeCount: tc.episodes, MediaType: "tv", Status: "airing",
			}}
			if got := item.forCour(current, tc.active).CourRelation; got != tc.want {
				t.Fatalf("relation = %s, want %s", got, tc.want)
			}
		})
	}
}

func TestRegionUsesProductionEvidence(t *testing.T) {
	if got := inferRegion(nil, []string{"中国风", "中华风"}, "OLM Division 2"); got != "jp" {
		t.Fatalf("region = %s, want jp", got)
	}
	if got := inferRegion(subject{"country": "中国、日本"}, []string{"日本"}, "OLM"); got != "unknown" {
		t.Fatalf("conflicting explicit countries returned %s", got)
	}
}

func TestBangumiFollowsActualSearchPageSize(t *testing.T) {
	offsets := make(chan string, 3)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.URL.Path != "/v0/search/subjects" {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
			http.NotFound(w, r)
			return
		}
		var request struct {
			Filter struct {
				AirDate []string `json:"air_date"`
			} `json:"filter"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode request: %v", err)
		}
		if want := []string{">=2026-04-01", "<=2026-12-31"}; !reflect.DeepEqual(request.Filter.AirDate, want) {
			t.Errorf("air date filter = %v, want %v", request.Filter.AirDate, want)
		}
		offset := r.URL.Query().Get("offset")
		offsets <- offset
		pages := map[string][]int{"0": {1, 2}, "2": {2, 3}, "4": {4}}
		items := make([]map[string]any, 0)
		for _, id := range pages[offset] {
			items = append(items, map[string]any{"id": id, "date": "2026-10-02", "platform": "TV"})
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": items, "total": 5})
	}))
	defer server.Close()
	client, err := newBangumi(server.URL, "", time.Now)
	if err != nil {
		t.Fatal(err)
	}
	items, err := client.fetchCour(context.Background(), cour{2026, 10})
	if err != nil || len(items) != 4 || items[3].ID != "bangumi:4" {
		t.Fatalf("items = %#v, error = %v", items, err)
	}
	close(offsets)
	var got []string
	for offset := range offsets {
		got = append(got, offset)
	}
	if want := []string{"0", "2", "4"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("offsets = %v, want %v", got, want)
	}
}
