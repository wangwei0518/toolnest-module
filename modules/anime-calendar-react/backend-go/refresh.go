package main

import (
	"context"
	"fmt"
	"time"
)

const weeklyTTL = 7 * 24 * time.Hour

func (s *service) refresh(ctx context.Context, c cour, force, updateLongRunning bool) (map[string]any, error) {
	if cached, found := s.store.read().Cours[c.key()]; found && !force &&
		cached.LastRefreshedAt != nil && recentlyCached(*cached.LastRefreshedAt, s.now(), 24*time.Hour) {
		return refreshResponse(cached, 0, 0), nil
	}
	result, err, _ := s.refreshes.Do("cour:"+c.key(), func() (any, error) {
		return s.fetchAndStoreCour(ctx, c, updateLongRunning)
	})
	if err != nil {
		return nil, err
	}
	return result.(map[string]any), nil
}

func (s *service) fetchAndStoreCour(ctx context.Context, c cour, updateLongRunning bool) (map[string]any, error) {
	start, end := c.bounds()
	cache := courCache{
		cour: c, CandidateStart: nullable(start.AddDate(0, -6, 0).Format(dateLayout)),
		CandidateEnd: nullable(end.Format(dateLayout)), Status: "refreshing",
	}
	if err := s.store.update(ctx, func(next *state) error {
		next.Cours[c.key()] = cache
		return nil
	}); err != nil {
		return nil, err
	}
	items, err := s.fetchCour(ctx, c)
	if err != nil {
		cache.Status, cache.Error = "failed", publicUpstreamError(err)
		saveCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		_ = s.store.update(saveCtx, func(next *state) error {
			next.Cours[c.key()] = cache
			return nil
		})
		return nil, err
	}
	cache.Fetched, cache.Unique = len(items), len(items)
	cache.LastRefreshedAt = nullable(isoTime(s.now()))
	cache.Status = "empty"
	var inserted, updated int
	err = s.store.update(ctx, func(next *state) error {
		known := next.knownItems(true)
		included := make([]animeItem, 0, len(items))
		longRunning := make([]animeItem, 0)
		for _, item := range items {
			item = withMark(mergePreservingEpisodes(known[item.ID], item), "")
			if item.isSingleEpisodeNonMovie() {
				continue
			}
			if updateLongRunning && item.AirDate != nil && item.episodesForEstimate()/12 >= 3 {
				longRunning = append(longRunning, asLongRunning(item))
			}
			item = item.forCour(c, false)
			switch item.CourRelation {
			case "new_this_cour":
				cache.New++
			case "continuing":
				cache.Continuing++
			case "long_running":
				cache.LongRunning++
			default:
				continue
			}
			included = append(included, item)
		}
		cache.Included = len(included)
		cache.Skipped = len(items) - cache.Included
		cache.CandidateStart = nullable(start.AddDate(0, -3, 0).Format(dateLayout))
		if cache.Included > 0 {
			cache.Status = "success"
		}
		previous := make([]animeItem, 0, len(next.Items))
		ids := make(map[string]bool, len(next.Items))
		for _, item := range next.Items {
			if !item.isSingleEpisodeNonMovie() {
				previous = append(previous, item)
				ids[item.ID] = true
			}
		}
		for _, item := range included {
			if ids[item.ID] {
				updated++
			} else {
				inserted++
			}
		}
		next.Items = mergeItems(previous, included)
		next.Cours[c.key()] = cache
		if updateLongRunning {
			s.saveLongRunning(next, longRunning)
		}
		next.Today = nil
		return nil
	})
	if err != nil {
		return nil, err
	}
	return refreshResponse(cache, inserted, updated), nil
}

func (s *service) fetchCour(ctx context.Context, c cour) ([]animeItem, error) {
	provider, err := s.provider()
	if err != nil {
		return nil, err
	}
	return provider.fetchCour(ctx, c)
}

func refreshResponse(cache courCache, inserted, updated int) map[string]any {
	status := cache.Status
	if status == "success" {
		status = "fresh"
	}
	return map[string]any{
		"year": cache.Year, "cour_month": cache.Month, "cour_label": cache.label(), "cache_status": status,
		"candidate_start": cache.CandidateStart, "candidate_end": cache.CandidateEnd, "fetched_count": cache.Fetched,
		"unique_count": cache.Unique, "included_count": cache.Included, "new_this_cour_count": cache.New,
		"continuing_count": cache.Continuing, "long_running_count": cache.LongRunning, "unknown_count": cache.Unknown,
		"skipped_count": cache.Skipped, "last_refreshed_at": cache.LastRefreshedAt,
		"inserted": inserted, "updated": updated, "total": cache.Included,
	}
}

func (s *service) weekly(ctx context.Context, force bool) (map[string]any, error) {
	if force {
		before := s.store.read().Weekly
		if err := s.refreshWeekly(ctx, true); err != nil {
			if before == nil {
				return nil, err
			}
			return weeklyResponse(before.Items, s.store.read().Marks, before.UpdatedAt), nil
		}
	}
	state := s.store.read()
	stamp := ""
	if state.Weekly != nil {
		stamp = state.Weekly.UpdatedAt
	}
	return weeklyResponse(state.enrichedWeekly(), state.Marks, stamp), nil
}

func (s *service) refreshWeekly(ctx context.Context, force bool) error {
	if cache := s.store.read().Weekly; !force && cache != nil && recentlyCached(cache.UpdatedAt, s.now(), weeklyTTL) {
		return nil
	}
	_, err, _ := s.refreshes.Do("weekly", func() (any, error) {
		provider, err := s.provider()
		if err != nil {
			return nil, err
		}
		items, err := provider.fetchWeekly(ctx)
		if err != nil {
			return nil, err
		}
		return nil, s.store.update(ctx, func(next *state) error {
			now := s.now()
			items = enrichWeekly(mergeItems(items, cachedItems(next.LongRunning)), next.knownItems(false))
			for index, item := range items {
				items[index] = withMark(item.forCour(courAt(now.In(s.zone)), false), "")
			}
			next.Weekly = &dataCache{now.In(s.zone).Format(dateLayout), isoTime(now), items}
			next.Today = nil
			return nil
		})
	})
	return err
}

func (s *service) refreshLongRunning(ctx context.Context) (map[string]any, error) {
	now := s.now().In(s.zone)
	items, err := s.fetchCour(ctx, courAt(now))
	if err != nil {
		if cache := s.store.read().LongRunning; cache != nil {
			return longRunningResponse("failed", nil, nil, 0, len(cache.Items), cache.UpdatedAt, publicUpstreamError(err)), nil
		}
		return nil, err
	}
	retained := make([]animeItem, 0, len(items))
	for _, item := range items {
		if item.AirDate != nil && item.episodesForEstimate()/12 >= 3 && !item.isSingleEpisodeNonMovie() {
			retained = append(retained, asLongRunning(withMark(item, "")))
		}
	}
	status, message := "empty", "未发现仍在放送的长剧集"
	if len(retained) > 0 {
		status, message = "success", "长剧集缓存已更新"
	}
	var updatedAt string
	err = s.store.update(ctx, func(next *state) error {
		s.saveLongRunning(next, retained)
		updatedAt = next.LongRunning.UpdatedAt
		return nil
	})
	return longRunningResponse(status, nullable(now.UTC().AddDate(0, 0, -183).Format(dateLayout)),
		nullable(now.Format(dateLayout)), len(items), len(retained), updatedAt, message), err
}

func longRunningResponse(status string, start, end *string, fetched, retained int, maintenance, message string) map[string]any {
	return map[string]any{"refresh_status": status, "source_start": start, "source_end": end, "fetched_count": fetched,
		"retained_count": retained, "last_maintenance_at": maintenance, "message": message}
}

func (s *service) saveLongRunning(next *state, items []animeItem) {
	now := s.now()
	next.LongRunning = &dataCache{now.In(s.zone).Format(dateLayout), isoTime(now), items}
	if next.Weekly != nil {
		weekly := make(map[string]animeItem, len(next.Weekly.Items))
		for _, item := range next.Weekly.Items {
			weekly[item.ID] = item
		}
		adjusted := make([]animeItem, 0, len(items))
		for _, item := range items {
			if previous, found := weekly[item.ID]; found {
				item.Weekday, item.AirTime = previous.Weekday, previous.AirTime
			}
			adjusted = append(adjusted, item)
		}
		next.Weekly.Items = mergeItems(next.Weekly.Items, adjusted)
	}
	next.Today = nil
}

func asLongRunning(item animeItem) animeItem {
	item.CourRelation, item.CourRelationLabel = "long_running", "长期"
	return item
}

func publicUpstreamError(err error) string {
	return fmt.Sprint(err)
}
