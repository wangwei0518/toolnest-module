package main

import (
	"cmp"
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"time"

	"golang.org/x/sync/singleflight"
	"golang.org/x/text/collate"
	"golang.org/x/text/language"
)

type stateStore interface {
	read() *state
	update(context.Context, func(*state) error) error
}

type animeProvider interface {
	fetchCour(context.Context, cour) ([]animeItem, error)
	fetchWeekly(context.Context) ([]animeItem, error)
	fetchDetail(context.Context, string) (animeItem, error)
}

type service struct {
	store     stateStore
	now       func() time.Time
	zone      *time.Location
	provider  func() (animeProvider, error)
	refreshes singleflight.Group
}

type apiError struct {
	status  int
	message string
}

func (e apiError) Error() string { return e.message }

type itemQuery struct {
	Cour           cour
	Weekday        *int
	Status         string
	MediaType      string
	Keyword        string
	Mark           string
	IncludeIgnored bool
}

func (s *service) list(q itemQuery) map[string]any {
	state := s.store.read()
	items := make([]listItem, 0)
	for _, item := range s.itemsForCour(state, q.Cour) {
		if matchesQuery(item, q) {
			items = append(items, item.listItem)
		}
	}
	cache, cached := state.Cours[q.Cour.key()]
	status := "empty"
	switch {
	case cached && (cache.Status == "refreshing" || cache.Status == "failed"):
		status = cache.Status
	case len(items) > 0:
		status = "stale"
		if cached && cache.LastRefreshedAt != nil && recentlyCached(*cache.LastRefreshedAt, s.now(), 24*time.Hour) {
			status = "fresh"
		}
	}
	messages := map[string]string{
		"empty": "当前档期暂无缓存", "fresh": "缓存已是最新", "stale": "正在使用可能过期的缓存",
		"refreshing": "正在刷新档期数据", "failed": firstText(cache.Error, "刷新失败，已保留现有数据"),
	}
	start, end := q.Cour.bounds()
	return map[string]any{
		"year": q.Cour.Year, "cour_month": q.Cour.Month, "cour_label": q.Cour.label(),
		"date_range":   map[string]string{"start_date": start.Format(dateLayout), "end_date": end.Format(dateLayout)},
		"cache_status": status, "cache_message": messages[status], "last_refreshed_at": cache.LastRefreshedAt,
		"total": len(items), "items": items,
	}
}

func matchesQuery(item animeItem, q itemQuery) bool {
	mark := markOf(item)
	if (q.Weekday != nil && item.Weekday != *q.Weekday) ||
		(q.Status != "" && item.Status != q.Status) ||
		(q.MediaType != "" && item.MediaType != q.MediaType) ||
		(q.Mark != "" && mark != q.Mark) ||
		(!q.IncludeIgnored && q.Mark == "" && mark == "ignored") {
		return false
	}
	keyword := strings.ToLower(strings.TrimSpace(q.Keyword))
	return keyword == "" || strings.Contains(strings.ToLower(item.TitleCN), keyword) ||
		strings.Contains(strings.ToLower(item.TitleOriginal), keyword) ||
		strings.Contains(strings.ToLower(item.TitleRomaji), keyword) ||
		strings.Contains(strings.ToLower(item.Studio), keyword)
}

func (s *service) itemsForCour(state *state, c cour) []animeItem {
	current := courAt(s.now().In(s.zone))
	allowWeekly := c.Year*12+c.Month >= current.Year*12+current.Month
	active := make(map[string]bool)
	for _, item := range cachedItems(state.Weekly) {
		active[item.ID] = item.Status == "airing"
	}
	items := mergeItems(state.Items, state.enrichedWeekly(), cachedItems(state.LongRunning))
	result := make([]animeItem, 0, len(items))
	for _, item := range items {
		item = item.forCour(c, allowWeekly && active[item.ID])
		if item.CourRelation != "unknown" && !item.isSingleEpisodeNonMovie() {
			result = append(result, withMark(item, state.Marks[item.ID]))
		}
	}
	return result
}

func (s *service) stats(c cour) map[string]any {
	items := s.itemsForCour(s.store.read(), c)
	result := map[string]any{"year": c.Year, "cour_month": c.Month, "cour_label": c.label(), "total": len(items)}
	counts := map[string]int{"watching": 0, "ignored": 0, "airing": 0, "not_started": 0, "finished": 0, "today_updated": 0}
	date := s.now().In(s.zone)
	for _, item := range items {
		counts[markOf(item)]++
		counts[item.Status]++
		if item.scheduledOn(date) {
			counts["today_updated"]++
		}
	}
	delete(counts, "")
	delete(counts, "unknown")
	for key, value := range counts {
		result[key] = value
	}
	return result
}

func (s *service) mark(ctx context.Context, id, mark string) (map[string]any, error) {
	return map[string]any{"ok": true, "mark_type": nullable(mark)}, s.store.update(ctx, func(next *state) error {
		if _, found := next.findItem(id); !found {
			return apiError{404, "未找到该番剧"}
		}
		if mark == "" {
			delete(next.Marks, id)
		} else {
			next.Marks[id] = mark
		}
		next.Today = nil
		return nil
	})
}

func (s *service) detail(ctx context.Context, id string) (animeItem, error) {
	snapshot := s.store.read()
	base, found := snapshot.findItem(id)
	if !found {
		return animeItem{}, apiError{404, "未找到该番剧"}
	}
	base = withMark(base, snapshot.Marks[id])
	if cached, ok := snapshot.Details[id]; ok && recentlyCached(cached.CachedAt, s.now(), 7*24*time.Hour) {
		return mergeDetail(base, cached.Item), nil
	}
	provider, err := s.provider()
	if err != nil {
		return base, nil
	}
	item, err := provider.fetchDetail(ctx, base.ProviderID)
	if err != nil {
		return base, nil
	}
	merged := mergeDetail(base, item)
	if err := s.store.update(ctx, func(next *state) error {
		next.Details[id] = detailEntry{isoTime(s.now()), withMark(merged, "")}
		return nil
	}); err != nil {
		return base, nil
	}
	return withMark(merged, s.store.read().Marks[id]), nil
}

func (s *service) todayItems(ctx context.Context, zone *time.Location) (*dataCache, error) {
	date := s.now().In(zone)
	key := date.Format(dateLayout)
	snapshot := s.store.read()
	if snapshot.Today != nil && snapshot.Today.Date == key {
		return snapshot.Today, nil
	}
	var result *dataCache
	err := s.store.update(ctx, func(next *state) error {
		if next.Today != nil && next.Today.Date == key {
			result = next.Today
			return nil
		}
		result = &dataCache{Date: key, UpdatedAt: isoTime(s.now()), Items: make([]animeItem, 0)}
		for _, item := range next.enrichedWeekly() {
			if item.scheduledOn(date) {
				result.Items = append(result.Items, withMark(item, ""))
			}
		}
		next.Today = result
		return nil
	})
	return result, err
}

var weekdayLabels = [...]string{"未定", "周一", "周二", "周三", "周四", "周五", "周六", "周日"}

type weeklyDay struct {
	Weekday int        `json:"weekday"`
	Label   string     `json:"label"`
	Items   []listItem `json:"items"`
}

func weeklyResponse(items []animeItem, marks map[string]string, updatedAt string) map[string]any {
	days := make([]weeklyDay, 7)
	for index := range days {
		weekday := index + 1
		days[index] = weeklyDay{weekday, weekdayLabels[weekday], make([]listItem, 0)}
	}
	total := 0
	for _, item := range items {
		if item.Weekday < 1 || item.Weekday > 7 || marks[item.ID] == "ignored" {
			continue
		}
		day := &days[item.Weekday-1]
		day.Items = append(day.Items, withMark(item, marks[item.ID]).listItem)
		total++
	}
	chinese := collate.New(language.Chinese)
	for _, day := range days {
		slices.SortStableFunc(day.Items, func(a, b listItem) int {
			if order := cmp.Compare(firstText(a.AirTime, "99:99"), firstText(b.AirTime, "99:99")); order != 0 {
				return order
			}
			return chinese.CompareString(a.displayTitle(), b.displayTitle())
		})
	}
	return map[string]any{"source": "bangumi_calendar", "updated_at": updatedAt, "total": total, "days": days}
}

func (s *service) today(ctx context.Context, zone *time.Location) (map[string]any, error) {
	cache, err := s.todayItems(ctx, zone)
	if err != nil {
		return nil, err
	}
	date, err := time.Parse(dateLayout, cache.Date)
	if err != nil {
		return nil, fmt.Errorf("invalid today cache date: %w", err)
	}
	marks := s.store.read().Marks
	items := make([]listItem, 0, len(cache.Items))
	for _, item := range cache.Items {
		if marks[item.ID] != "ignored" && item.scheduledOn(date) {
			items = append(items, withMark(item, marks[item.ID]).listItem)
		}
	}
	return map[string]any{"source": "bangumi_calendar", "date": cache.Date, "updated_at": cache.UpdatedAt, "total": len(items), "items": items}, nil
}

func (s *service) settings() (settings, error) {
	return decodeSettings(s.store.read().Settings)
}

func (s *service) saveSettings(ctx context.Context, input json.RawMessage) (settings, error) {
	config, err := decodeSettings(input)
	if err == nil {
		err = config.validate()
	}
	if err != nil {
		return settings{}, apiError{422, err.Error()}
	}
	payload, err := json.Marshal(config)
	if err != nil {
		return settings{}, err
	}
	return config, s.store.update(ctx, func(next *state) error {
		next.Settings = payload
		return nil
	})
}

func (s *state) findItem(id string) (animeItem, bool) {
	for _, items := range [][]animeItem{s.Items, cachedItems(s.Weekly), cachedItems(s.LongRunning)} {
		for _, item := range items {
			if item.ID == id {
				return item, true
			}
		}
	}
	return animeItem{}, false
}

func (s *state) enrichedWeekly() []animeItem {
	return enrichWeekly(cachedItems(s.Weekly), s.knownItems(false))
}

func (s *state) knownItems(includeWeekly bool) map[string]animeItem {
	known := make(map[string]animeItem, len(s.Items)+len(s.Details))
	add := func(item animeItem) {
		known[item.ID] = mergePreservingEpisodes(known[item.ID], item)
	}
	groups := [][]animeItem{s.Items}
	if includeWeekly {
		groups = append(groups, cachedItems(s.Weekly))
	}
	groups = append(groups, cachedItems(s.LongRunning))
	for _, items := range groups {
		for _, item := range items {
			add(item)
		}
	}
	for _, entry := range s.Details {
		add(entry.Item)
	}
	return known
}

func enrichWeekly(items []animeItem, known map[string]animeItem) []animeItem {
	result := make([]animeItem, 0, len(items))
	for _, item := range items {
		if cached, found := known[item.ID]; found {
			item.Studio = firstText(cached.Studio, item.Studio)
			if len(cached.Tags) > 0 {
				item.Tags = cached.Tags
			}
			if cached.Region != "" && cached.Region != "unknown" {
				item.Region = cached.Region
			}
			if len(cached.Raw) > 0 {
				item.Raw = cached.Raw
			}
			if cached.MediaType != "" && cached.MediaType != "unknown" {
				item.MediaType = cached.MediaType
			}
			item = mergePreservingEpisodes(cached, item)
			if item.EstimatedEndDate == nil {
				item.EstimatedEndDate = cached.EstimatedEndDate
			}
		}
		result = append(result, item)
	}
	return result
}

func mergeItems(groups ...[]animeItem) []animeItem {
	result := make([]animeItem, 0)
	index := make(map[string]int)
	for _, items := range groups {
		for _, item := range items {
			if pos, found := index[item.ID]; found {
				result[pos] = mergePreservingEpisodes(result[pos], item)
			} else {
				index[item.ID] = len(result)
				result = append(result, item)
			}
		}
	}
	return result
}

func mergePreservingEpisodes(previous, next animeItem) animeItem {
	if next.EpisodeCount == nil && previous.EpisodeCount != nil {
		next.EpisodeCount = previous.EpisodeCount
		next.EstimatedEndDate = previous.EstimatedEndDate
	}
	return next
}

func mergeDetail(base, detail animeItem) animeItem {
	detail.ID, detail.ProviderID = base.ID, base.ProviderID
	detail.Year, detail.CourMonth, detail.CourLabel = base.Year, base.CourMonth, base.CourLabel
	detail.CourRelation, detail.CourRelationLabel = base.CourRelation, base.CourRelationLabel
	detail.Weekday, detail.AirTime, detail.MarkType = base.Weekday, base.AirTime, base.MarkType
	return detail
}

func cachedItems(cache *dataCache) []animeItem {
	if cache == nil {
		return nil
	}
	return cache.Items
}

func recentlyCached(value string, now time.Time, ttl time.Duration) bool {
	date, err := time.Parse(time.RFC3339Nano, value)
	return err == nil && now.Sub(date) < ttl
}

func withMark(item animeItem, mark string) animeItem {
	item.MarkType = nullable(mark)
	return item
}

func nullable(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func markOf(item animeItem) string {
	if item.MarkType == nil {
		return ""
	}
	return *item.MarkType
}

func (item listItem) displayTitle() string {
	return firstText(item.TitleCN, item.TitleOriginal)
}
