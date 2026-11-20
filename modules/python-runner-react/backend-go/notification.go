package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

type notificationConfig struct {
	NotifyOnFailure         bool     `json:"notify_on_failure"`
	FailureThresholdEnabled bool     `json:"failure_threshold_enabled"`
	FailureThreshold        int      `json:"failure_threshold"`
	NotifyOnSuccess         bool     `json:"notify_on_success"`
	NotifyOnRecovered       bool     `json:"notify_on_recovered"`
	ForwardOutputOnSuccess  bool     `json:"forward_output_on_success"`
	OutputMode              string   `json:"output_mode"`
	MaxLines                int      `json:"max_lines"`
	MaxChars                int      `json:"max_chars"`
	NotifyWhenEmptyOutput   bool     `json:"notify_when_empty_output"`
	Channels                string   `json:"channels"`
	CustomChannels          []string `json:"custom_channels"`
	EmailRecipients         []string `json:"email_recipients"`
}

func normalizeNotification(raw any) notificationConfig {
	input, _ := raw.(map[string]any)
	integer := func(key string, fallback, minimum, maximum int) int {
		switch n := input[key].(type) {
		case float64:
			return int(min(float64(maximum), max(float64(minimum), n)))
		case int:
			return min(maximum, max(minimum, n))
		}
		return fallback
	}
	allowed := map[string]bool{"web_internal": true, "qqbot": true, "email": true, "webhook": true}
	mode, _ := input["output_mode"].(string)
	switch mode {
	case "summary", "stderr", "both":
	default:
		mode = "stdout"
	}
	channels := "default"
	if input["channels"] == "custom" {
		channels = "custom"
	}
	return notificationConfig{
		NotifyOnFailure:         input["notify_on_failure"] != false,
		FailureThresholdEnabled: input["failure_threshold_enabled"] != false,
		FailureThreshold:        integer("failure_threshold", 3, 1, 100),
		NotifyOnSuccess:         input["notify_on_success"] == true,
		NotifyOnRecovered:       input["notify_on_recovered"] == true,
		ForwardOutputOnSuccess:  input["forward_output_on_success"] == true,
		OutputMode:              mode,
		MaxLines:                integer("max_lines", 100, 1, 500),
		MaxChars:                integer("max_chars", 4000, 100, 20000),
		NotifyWhenEmptyOutput:   input["notify_when_empty_output"] == true,
		Channels:                channels,
		CustomChannels: notificationStrings(input["custom_channels"], func(s string) string {
			s = strings.ToLower(s)
			if allowed[s] {
				return s
			}
			return ""
		}),
		EmailRecipients: notificationStrings(input["email_recipients"], func(s string) string { return s }),
	}
}

func notificationStrings(value any, transform func(string) string) []string {
	items, _ := value.([]any)
	result := []string{}
	seen := map[string]bool{}
	for _, item := range items {
		s, ok := item.(string)
		if !ok {
			continue
		}
		s = transform(strings.TrimSpace(s))
		if s != "" && !seen[s] {
			result = append(result, s)
			seen[s] = true
		}
	}
	return result
}

type notificationExecution struct {
	ID, Name, Status, Stdout, Stderr string
	DurationMS                       int64
}

func executionNotification(e notificationExecution, c notificationConfig, recovered bool) map[string]any {
	failed := e.Status == "failed" || e.Status == "timeout"
	success := e.Status == "success"
	content := ""
	if failed && c.NotifyOnFailure {
		content = e.Stderr
		if content == "" {
			content = e.Stdout
		}
		if content == "" {
			content = "无错误输出"
		}
	} else if success && (c.NotifyOnSuccess || c.ForwardOutputOnSuccess || (recovered && c.NotifyOnRecovered)) {
		switch c.OutputMode {
		case "summary":
			content = fmt.Sprintf("任务：%s\n状态：%s\n耗时：%d ms", e.Name, e.Status, e.DurationMS)
		case "stderr":
			content = e.Stderr
		case "both":
			content = "stdout:\n" + e.Stdout + "\n\nstderr:\n" + e.Stderr
		default:
			content = e.Stdout
		}
	} else {
		return nil
	}
	if failed || c.OutputMode != "summary" {
		content = notificationTail(content, c.MaxLines, c.MaxChars)
	}
	content = redactNotification(content)
	if success && strings.TrimSpace(content) == "" {
		if c.ForwardOutputOnSuccess && !c.NotifyWhenEmptyOutput && !c.NotifyOnSuccess {
			return nil
		}
		content = "无输出"
	}
	event, level, title := "execution_success", "success", "Python 任务执行成功："
	if failed {
		event, level, title = "execution_failed", "error", "Python 任务执行失败："
	}
	out := map[string]any{
		"event_type": event, "level": level, "title": title + e.Name,
		"summary": "", "content": content, "source_type": "execution", "source_id": e.ID,
		"email_recipients": c.EmailRecipients,
	}
	if c.Channels == "custom" {
		out["channels"] = c.CustomChannels
	}
	return out
}

func notificationTail(value string, maxLines, maxChars int) string {
	lines := strings.Split(strings.ReplaceAll(value, "\r\n", "\n"), "\n")
	runes := []rune(strings.Join(lines[max(0, len(lines)-maxLines):], "\n"))
	return string(runes[max(0, len(runes)-maxChars):])
}

var secretAssignment = regexp.MustCompile(`(?i)((?:password|passwd|secret|token|api[_-]?key|authorization|private[_-]?key)\s*[:=]\s*)([^\s,;]+)`)
var urlPassword = regexp.MustCompile(`(?i)((?:postgres(?:ql)?|https?)://[^\s:/]+:)[^@\s]+(@)`)

func redactNotification(s string) string {
	return urlPassword.ReplaceAllString(secretAssignment.ReplaceAllString(s, "${1}********"), "${1}********${2}")
}

type notifier struct {
	moduleID, token, endpoint string
}

func newNotifier(c config, platformURL string) notifier {
	endpoint := ""
	if base := strings.TrimSpace(platformURL); base != "" {
		endpoint = strings.TrimSuffix(base, "/") + "/internal/modules/" + url.PathEscape(c.moduleID) + "/notifications"
	}
	return notifier{moduleID: c.moduleID, token: c.token, endpoint: endpoint}
}

func (n notifier) send(ctx context.Context, input map[string]any) {
	if n.endpoint == "" || input == nil {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	body := make(map[string]any, len(input)+1)
	for key, value := range input {
		body[key] = value
	}
	body["module_id"] = n.moduleID
	data, err := json.Marshal(body)
	if err != nil {
		log.Print("could not encode Python Runner notification")
		return
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, n.endpoint, bytes.NewReader(data))
	if err != nil {
		return
	}
	request.Header.Set("Content-Type", "application/json; charset=utf-8")
	request.Header.Set("X-ToolNest-Internal-Token", n.token)
	client := http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(request)
	if err != nil {
		log.Print("could not send Python Runner notification")
		return
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		log.Printf("Python Runner notification returned HTTP %d", response.StatusCode)
	}
}
