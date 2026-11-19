package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type bangumi struct {
	base   string
	client *http.Client
	now    func() time.Time
}

func newBangumi(base, proxy string, now func() time.Time) (*bangumi, error) {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	if proxy != "" {
		u, err := url.Parse(proxy)
		if err != nil || u.Host == "" {
			return nil, errors.New("代理地址无效")
		}
		transport.Proxy = http.ProxyURL(u)
	}
	client := &http.Client{
		Transport: transport,
		Timeout:   25 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	return &bangumi{strings.TrimRight(base, "/"), client, now}, nil
}

func (b *bangumi) request(ctx context.Context, method, path string, body, target any) error {
	var reader io.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(payload)
	}
	req, err := http.NewRequestWithContext(ctx, method, b.base+path, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "ToolNest-Anime-Calendar/0.1.0 (https://github.com/wangwei0518/toolnest-module)")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := b.client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return errors.New("无法连接 Bangumi，请检查网络或代理设置")
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("Bangumi 请求失败（HTTP %d）", resp.StatusCode)
	}
	const maxBody = 16 << 20
	payload, err := io.ReadAll(io.LimitReader(resp.Body, maxBody+1))
	if err != nil || len(payload) > maxBody || json.Unmarshal(payload, target) != nil {
		return errors.New("Bangumi 返回了无法解析的数据")
	}
	return nil
}

type subject map[string]any

func (b *bangumi) fetchCour(ctx context.Context, c cour) ([]animeItem, error) {
	start, end := c.bounds()
	query := map[string]any{
		"keyword": "", "sort": "rank",
		"filter": map[string]any{"type": []int{2}, "air_date": []string{
			">=" + start.AddDate(0, -6, 0).Format(dateLayout), "<=" + end.Format(dateLayout),
		}},
	}
	items := make([]animeItem, 0)
	seen := make(map[string]bool)
	for offset := 0; offset < 1000; {
		var page struct {
			Data  []subject `json:"data"`
			Total *int      `json:"total"`
		}
		path := fmt.Sprintf("/v0/search/subjects?limit=100&offset=%d", offset)
		if err := b.request(ctx, http.MethodPost, path, query, &page); err != nil {
			return nil, err
		}
		if len(page.Data) == 0 {
			break
		}
		for _, entry := range page.Data {
			id := subjectID(entry["id"])
			if id != "" && !seen[id] {
				seen[id] = true
				items = append(items, mapSubject(entry, c, b.now()))
			}
		}
		offset += len(page.Data)
		if page.Total != nil && offset >= *page.Total {
			break
		}
	}
	return items, nil
}

func (b *bangumi) fetchWeekly(ctx context.Context) ([]animeItem, error) {
	var days []struct {
		Weekday struct {
			ID int `json:"id"`
		} `json:"weekday"`
		Items []subject `json:"items"`
	}
	if err := b.request(ctx, http.MethodGet, "/calendar", nil, &days); err != nil {
		return nil, err
	}
	if days == nil {
		return nil, errors.New("Bangumi 周历响应格式异常")
	}
	items := make([]animeItem, 0)
	seen := make(map[string]bool)
	now := b.now()
	for index, day := range days {
		weekday := day.Weekday.ID
		if weekday == 0 {
			weekday = index + 1
		}
		for _, entry := range day.Items {
			id := subjectID(entry["id"])
			if id == "" || seen[id] {
				continue
			}
			seen[id] = true
			date, err := time.Parse(dateLayout, stringValue(firstValue(entry["air_date"], entry["date"])))
			c := courAt(now)
			if err == nil {
				c = courAt(date)
			}
			item := mapSubject(entry, c, now)
			item.Weekday = weekday
			item.MediaType = mediaType(stringValue(entry["type"]))
			if numberValue(entry["type"]) == 2 {
				item.MediaType = "tv"
			}
			if err == nil && !date.After(now) {
				item.Status = "airing"
			}
			if item.EpisodeCount == nil {
				item.EstimatedEndDate = nil
			}
			items = append(items, item)
		}
	}
	return items, nil
}

func (b *bangumi) fetchDetail(ctx context.Context, id string) (animeItem, error) {
	var entry subject
	if err := b.request(ctx, http.MethodGet, "/v0/subjects/"+url.PathEscape(id), nil, &entry); err != nil {
		return animeItem{}, err
	}
	if entry == nil {
		return animeItem{}, errors.New("Bangumi 详情响应格式异常")
	}
	now := b.now()
	c := courAt(now)
	if date, err := time.Parse(dateLayout, stringValue(entry["date"])); err == nil {
		c = courAt(date)
	}
	return mapSubject(entry, c, now), nil
}

var airTimePattern = regexp.MustCompile(`^[0-9]{2}:[0-9]{2}$`)

func mapSubject(entry subject, c cour, now time.Time) animeItem {
	id := subjectID(entry["id"])
	infobox, _ := entry["infobox"].([]any)
	studio := infoboxValue(infobox, "动画制作", "制作", "制作公司", "studio")
	tags := make([]string, 0, 24)
	if rawTags, ok := entry["tags"].([]any); ok {
		for _, tag := range rawTags {
			obj, ok := tag.(map[string]any)
			if ok {
				tag = obj["name"]
			}
			if name := stringValue(tag); name != "" {
				tags = append(tags, name)
				if len(tags) == 24 {
					break
				}
			}
		}
	}
	images, _ := entry["images"].(map[string]any)
	item := animeItem{
		listItem: listItem{
			ID: "bangumi:" + id, Provider: "bangumi", ProviderID: id,
			TitleCN:       stringValue(entry["name_cn"]),
			TitleOriginal: firstText(stringValue(entry["name"]), stringValue(entry["name_cn"]), "Bangumi "+id),
			CoverURL:      firstText(stringValue(images["large"]), stringValue(images["common"]), stringValue(images["medium"]), stringValue(images["small"])),
			Studio:        studio, Year: c.Year, CourMonth: c.Month, CourLabel: c.label(),
			CourRelation: "unknown", CourRelationLabel: "未定", Status: "unknown",
			MediaType:      mediaType(stringValue(firstValue(entry["platform"], infoboxValue(infobox, "类型", "播放平台")))),
			EpisodeCount:   positiveInt(firstValue(entry["total_episodes"], entry["eps"])),
			CurrentEpisode: positiveInt(firstValue(entry["current_episode"], entry["currentEpisode"], entry["episode"])),
			ExternalURL:    "https://bgm.tv/subject/" + id,
			Region:         inferRegion(entry, tags, studio),
		},
		TitleRomaji: infoboxValue(infobox, "英文名", "别名"), Summary: stringValue(entry["summary"]),
		Tags: tags, Raw: entry, CreatedAt: isoTime(now), UpdatedAt: isoTime(now),
	}
	if rating, ok := entry["rating"].(map[string]any); ok {
		if value := numberValue(rating["score"]); value > 0 {
			score := math.Round(value*10) / 10
			item.Score = &score
		}
	}
	if value := stringValue(entry["air_time"]); airTimePattern.MatchString(value) {
		item.AirTime = value
	}
	if date, err := time.Parse(dateLayout, stringValue(firstValue(entry["date"], entry["air_date"]))); err == nil {
		key := date.Format(dateLayout)
		item.AirDate, item.AirMonth = &key, key[:7]
		item.Weekday = isoWeekday(date)
		item.EstimatedEndDate = item.estimatedEnd()
		item.Status = "airing"
		if date.After(now) {
			item.Status = "not_started"
		} else if end, err := time.Parse(dateLayout, *item.EstimatedEndDate); err == nil && end.Before(now) {
			item.Status = "finished"
		}
	}
	if weekday := int(numberValue(entry["air_weekday"])); weekday >= 1 && weekday <= 7 {
		item.Weekday = weekday
	}
	return item
}

func isoTime(value time.Time) string {
	return value.UTC().Format("2006-01-02T15:04:05.000Z")
}

func firstValue(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func firstText(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func subjectID(value any) string {
	switch value := value.(type) {
	case float64:
		return strconv.FormatFloat(value, 'f', -1, 64)
	case string:
		return value
	default:
		return ""
	}
}

func stringValue(value any) string {
	s, _ := value.(string)
	return strings.TrimSpace(s)
}

func numberValue(value any) float64 {
	switch value := value.(type) {
	case float64:
		if !math.IsInf(value, 0) && !math.IsNaN(value) {
			return value
		}
	case string:
		if number, err := strconv.ParseFloat(strings.TrimSpace(value), 64); err == nil {
			return numberValue(number)
		}
	}
	return 0
}

func positiveInt(value any) *int {
	if number := int(numberValue(value)); number > 0 {
		return &number
	}
	return nil
}

func mediaType(value string) string {
	text := strings.ToLower(value)
	switch {
	case strings.Contains(text, "剧场") || strings.Contains(text, "movie"):
		return "movie"
	case strings.Contains(text, "ova"):
		return "ova"
	case strings.Contains(text, "web") || strings.Contains(text, "ona"):
		return "ona"
	case strings.Contains(text, "sp") || strings.Contains(text, "special"):
		return "sp"
	case strings.Contains(text, "tv") || strings.Contains(text, "电视"):
		return "tv"
	default:
		return "unknown"
	}
}

func infoboxValue(fields []any, keys ...string) string {
	for _, field := range fields {
		entry, _ := field.(map[string]any)
		for _, key := range keys {
			if !strings.EqualFold(stringValue(entry["key"]), key) {
				continue
			}
			switch value := entry["value"].(type) {
			case string:
				return value
			case []any:
				var values []string
				for _, item := range value {
					if object, ok := item.(map[string]any); ok {
						item = object["v"]
					}
					if text := stringValue(item); text != "" {
						values = append(values, text)
					}
				}
				return strings.Join(values, " / ")
			}
		}
	}
	return ""
}
