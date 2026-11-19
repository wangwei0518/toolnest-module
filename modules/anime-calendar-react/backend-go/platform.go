package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"
)

const internalTokenHeader = "X-ToolNest-Internal-Token"

type platformProfile struct {
	zone      *time.Location
	publicURL string
}

type platformClient struct {
	base, moduleID, token string
	client                *http.Client
	mu                    sync.Mutex
	profile               platformProfile
	expires               time.Time
}

func newPlatformClient(base, moduleID, token string, zone *time.Location) *platformClient {
	return &platformClient{
		base: strings.TrimRight(base, "/"), moduleID: moduleID, token: token,
		client: &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		}},
		profile: platformProfile{zone: zone},
	}
}

func (p *platformClient) request(ctx context.Context, method, route string, payload []byte, result any) (bool, error) {
	req, err := http.NewRequestWithContext(ctx, method, p.base+"/internal/modules/"+url.PathEscape(p.moduleID)+route, bytes.NewReader(payload))
	if err != nil {
		return false, err
	}
	req.Header.Set(internalTokenHeader, p.token)
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := p.client.Do(req)
	if err != nil {
		return false, err
	}
	defer res.Body.Close()
	ok := res.StatusCode >= 200 && res.StatusCode < 300
	const maxResponse = 2 << 20
	body, err := io.ReadAll(io.LimitReader(res.Body, maxResponse+1))
	if err != nil || len(body) > maxResponse {
		return ok, fmt.Errorf("invalid platform response body")
	}
	return ok, json.Unmarshal(body, result)
}

func (p *platformClient) context(ctx context.Context) platformProfile {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.base == "" || p.token == "" || time.Now().Before(p.expires) {
		return p.profile
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	type response struct {
		Timezone  string `json:"timezone"`
		PublicURL string `json:"public_base_url"`
	}
	var payload struct {
		response
		Data *response `json:"data"`
	}
	ok, err := p.request(ctx, http.MethodGet, "/platform-context", nil, &payload)
	if !ok || err != nil {
		p.expires = time.Now().Add(10 * time.Second)
		return p.profile
	}
	value := payload.response
	if payload.Data != nil {
		value = *payload.Data
	}
	if value.Timezone != "" {
		if zone, err := time.LoadLocation(value.Timezone); err == nil {
			p.profile.zone = zone
		}
	}
	if u, err := url.Parse(strings.TrimSpace(value.PublicURL)); err == nil && u.Host != "" && (u.Scheme == "http" || u.Scheme == "https") {
		p.profile.publicURL = strings.TrimRight(u.String(), "/")
	}
	p.expires = time.Now().Add(30 * time.Second)
	return p.profile
}

type noticeResult struct {
	OK         bool              `json:"ok"`
	ID         *string           `json:"notification_id"`
	Message    string            `json:"message"`
	Deliveries []json.RawMessage `json:"deliveries"`
}

func (p *platformClient) send(ctx context.Context, title, content string, channels []string, source, suffix string) noticeResult {
	result := noticeResult{Deliveries: []json.RawMessage{}}
	if p.base == "" || p.token == "" {
		result.Message = "平台通知服务未配置"
		return result
	}
	event := source
	if strings.HasPrefix(source, "test") {
		event = "test"
	}
	payload := map[string]any{
		"title": title, "content": content, "summary": "", "level": "info",
		"event_type": "anime_calendar." + event, "source_type": "anime_calendar",
		"source_id": source, "related_url": "/modules/" + p.moduleID + suffix,
	}
	if !slices.Contains(channels, "default") {
		payload["channels"] = channels
	}
	body, _ := json.Marshal(payload)
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	var response struct {
		ID             *string           `json:"id"`
		NotificationID *string           `json:"notification_id"`
		Message        string            `json:"message"`
		Deliveries     []json.RawMessage `json:"deliveries"`
	}
	ok, err := p.request(ctx, http.MethodPost, "/notifications", body, &response)
	if err != nil {
		result.Message = "无法连接平台通知服务"
		return result
	}
	if !ok {
		result.Message = firstText(response.Message, "平台通知发送失败")
		return result
	}
	result.OK, result.ID, result.Message = true, response.ID, "测试通知已发送"
	if result.ID == nil {
		result.ID = response.NotificationID
	}
	if response.Deliveries != nil {
		result.Deliveries = response.Deliveries
	}
	return result
}
