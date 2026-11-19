package main

import (
	"context"
	"crypto/sha256"
	"fmt"
	"slices"
	"strings"
	"time"
)

type notifications struct {
	service  *service
	platform *platformClient
}

func (n notifications) test(ctx context.Context, config settings, kind string) (noticeResult, error) {
	profile := n.platform.context(ctx)
	now := n.service.now().In(profile.zone)
	source := fmt.Sprintf("test-%s-%d", kind, now.UnixMilli())
	if kind == "cour" {
		return n.sendCour(ctx, config.Notifications.Cour, courAt(now), profile, source, false)
	}
	date, items, err := n.watchingItems(ctx, profile.zone, config.Notifications.Watching)
	if err != nil {
		return noticeResult{}, err
	}
	return n.sendWatching(ctx, config.Notifications.Watching, profile, date, items, source), nil
}

func (n notifications) run(ctx context.Context) error {
	config, err := n.service.settings()
	if err != nil {
		return err
	}
	courConfig, watching := config.Notifications.Cour, config.Notifications.Watching
	if !courConfig.Enabled && !watching.Enabled {
		return nil
	}
	profile := n.platform.context(ctx)
	now := n.service.now().In(profile.zone)
	clock := now.Format("15:04")
	if courConfig.Enabled && clock >= courConfig.SendTime {
		offset := 0
		if courConfig.ScheduleMode == "offset" {
			offset = courConfig.OffsetDays
		}
		target := now.AddDate(0, 0, offset)
		if target.Day() == 1 && (target.Month()-1)%3 == 0 {
			c := courAt(target)
			key := fmt.Sprintf("cour-release:%d:%d:default", c.Year, c.Month)
			if _, sent := n.service.store.read().Notifications[key]; !sent {
				result, err := n.sendCour(ctx, courConfig, c, profile, c.key(), true)
				if err != nil {
					return err
				}
				if err := n.remember(ctx, key, result); err != nil {
					return err
				}
			}
		}
	}
	if !watching.Enabled || clock < watching.SendTime {
		return nil
	}
	date, items, err := n.watchingItems(ctx, profile.zone, watching)
	if err != nil || len(items) == 0 {
		return err
	}
	groups := [][]animeItem{items}
	if watching.DeliveryMode == "single" {
		groups = make([][]animeItem, 0, len(items))
		for i := range items {
			groups = append(groups, items[i:i+1])
		}
	}
	for _, group := range groups {
		suffix := group[0].ID
		if watching.DeliveryMode != "single" {
			ids := make([]string, 0, len(group))
			for _, item := range group {
				ids = append(ids, item.ID)
			}
			slices.Sort(ids)
			hash := sha256.Sum256([]byte(strings.Join(ids, ",")))
			suffix = fmt.Sprintf("%x", hash[:8])
		}
		key := "watching-update:" + date + ":" + suffix
		if _, sent := n.service.store.read().Notifications[key]; sent {
			continue
		}
		result := n.sendWatching(ctx, watching, profile, date, group, date)
		if err := n.remember(ctx, key, result); err != nil {
			return err
		}
	}
	return nil
}

func (n notifications) remember(ctx context.Context, key string, result noticeResult) error {
	if !result.OK {
		return nil
	}
	return n.service.store.update(ctx, func(state *state) error {
		state.Notifications[key] = historyEntry{isoTime(n.service.now()), result.ID}
		return nil
	})
}

func (n notifications) sendCour(ctx context.Context, rule courRule, c cour, profile platformProfile, source string, scheduled bool) (noticeResult, error) {
	snapshot := n.service.store.read()
	items := make([]animeItem, 0)
	newCount, continuingCount := 0, 0
	for _, item := range snapshot.Items {
		item = item.forCour(c, false)
		if item.CourRelation == "unknown" || item.isSingleEpisodeNonMovie() || !matchesRule(item, rule.notificationRule) ||
			(rule.MinScore != nil && (item.Score == nil || *item.Score < *rule.MinScore)) {
			continue
		}
		items = append(items, item)
		switch item.CourRelation {
		case "new_this_cour":
			newCount++
		case "continuing":
			continuingCount++
		}
	}
	if scheduled && len(items) < rule.MinimumCount {
		return noticeResult{}, nil
	}
	values := map[string]string{
		"year": fmt.Sprint(c.Year), "cour_month": fmt.Sprint(c.Month), "cour_label": c.label(),
		"total_count": fmt.Sprint(len(items)), "new_count": fmt.Sprint(newCount), "continuing_count": fmt.Sprint(continuingCount),
		"region": regionText(rule.Regions), "anime_list": animeList(items), "refresh_time": isoTime(n.service.now()),
		"module_url": profile.publicURL + "/modules/" + n.platform.moduleID,
	}
	return n.platform.send(ctx, renderTemplate(rule.TitleTemplate, values), renderTemplate(rule.BodyTemplate, values), rule.Channels, source, ""), nil
}

func (n notifications) watchingItems(ctx context.Context, zone *time.Location, rule watchingRule) (string, []animeItem, error) {
	cache, err := n.service.todayItems(ctx, zone)
	if err != nil {
		return "", nil, err
	}
	date, err := time.Parse(dateLayout, cache.Date)
	if err != nil {
		return "", nil, err
	}
	marks := n.service.store.read().Marks
	items := make([]animeItem, 0)
	for _, item := range cache.Items {
		if marks[item.ID] == "watching" && item.scheduledOn(date) && matchesRule(item, rule.notificationRule) {
			items = append(items, item)
		}
	}
	return cache.Date, items, nil
}

func (n notifications) sendWatching(ctx context.Context, rule watchingRule, profile platformProfile, date string, items []animeItem, source string) noticeResult {
	day, _ := time.Parse(dateLayout, date)
	values := map[string]string{
		"date": date, "weekday": weekdayLabels[isoWeekday(day)], "count": fmt.Sprint(len(items)),
		"anime_list": animeList(items), "region": regionText(rule.Regions),
		"module_url": profile.publicURL + "/modules/" + n.platform.moduleID + "/weekly",
	}
	if len(items) > 0 {
		item := items[0]
		values["anime_title"], values["anime_title_original"] = item.displayTitle(), item.TitleOriginal
		values["media_type"], values["cour_relation"], values["bangumi_url"] = item.MediaType, item.CourRelationLabel, item.ExternalURL
		if item.Score != nil {
			values["score"] = fmt.Sprint(*item.Score)
		}
	}
	return n.platform.send(ctx, renderTemplate(rule.TitleTemplate, values), renderTemplate(rule.BodyTemplate, values), rule.Channels, source, "/weekly")
}

func matchesRule(item animeItem, rule notificationRule) bool {
	return (rule.IncludeContinuing || item.CourRelation != "continuing") &&
		(slices.Contains(rule.Regions, "all") || slices.Contains(rule.Regions, item.Region))
}

func renderTemplate(template string, values map[string]string) string {
	return templateVariable.ReplaceAllStringFunc(template, func(token string) string { return values[token[1:len(token)-1]] })
}

func regionText(regions []string) string {
	if slices.Contains(regions, "all") {
		return "全部地区"
	}
	return strings.Join(regions, "、")
}

func animeList(items []animeItem) string {
	if len(items) == 0 {
		return "暂无匹配作品"
	}
	count := min(len(items), 20)
	lines := make([]string, 0, count)
	for _, item := range items[:count] {
		line := "- " + item.displayTitle()
		if item.AirTime != "" {
			line += "（" + item.AirTime + "）"
		}
		lines = append(lines, line)
	}
	return strings.Join(lines, "\n")
}
