package main

import (
	"context"
	"log"
	"time"
)

type scheduler struct {
	service  *service
	platform *platformClient
	retryAt  map[string]time.Time
}

func (s scheduler) refresh(ctx context.Context) error {
	config, err := s.service.settings()
	if err != nil {
		return err
	}
	now := s.service.now().In(s.platform.context(ctx).zone)
	if now.Format("15:04") < config.DataRefreshTime {
		return nil
	}
	current := courAt(now)
	start, _ := current.bounds()
	next := courAt(start.AddDate(0, 3, 0))
	snapshot := s.service.store.read()
	currentCache := snapshot.Cours[current.key()]
	nextCache := snapshot.Cours[next.key()]
	var weeklyUpdated string
	if snapshot.Weekly != nil {
		weeklyUpdated = snapshot.Weekly.UpdatedAt
	}
	tasks := []struct {
		key string
		due bool
		run func() error
	}{
		{"current-cour", !refreshedOn(currentCache.LastRefreshedAt, now), func() error {
			_, err := s.service.refresh(ctx, current, true, true)
			return err
		}},
		{"next-cour", nextCache.LastRefreshedAt == nil || !recentlyCached(*nextCache.LastRefreshedAt, now, weeklyTTL), func() error {
			_, err := s.service.refresh(ctx, next, true, false)
			return err
		}},
		{"weekly", !recentlyCached(weeklyUpdated, now, weeklyTTL), func() error {
			return s.service.refreshWeekly(ctx, true)
		}},
	}
	for _, task := range tasks {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if task.due && !now.Before(s.retryAt[task.key]) {
			if err := task.run(); err != nil {
				log.Printf("anime calendar scheduled refresh failed (%s): %v", task.key, err)
				s.retryAt[task.key] = now.Add(30 * time.Minute)
			} else {
				delete(s.retryAt, task.key)
			}
		}
	}
	return nil
}

func refreshedOn(last *string, now time.Time) bool {
	if last == nil {
		return false
	}
	stamp, err := time.Parse(time.RFC3339Nano, *last)
	return err == nil && stamp.In(now.Location()).Format(dateLayout) == now.Format(dateLayout)
}

func runEveryMinute(ctx context.Context, immediate bool, run func(context.Context) error) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	execute := func() {
		if err := run(ctx); err != nil && ctx.Err() == nil {
			log.Printf("anime calendar scheduled task failed: %v", err)
		}
	}
	if immediate {
		execute()
	}
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			execute()
		}
	}
}
