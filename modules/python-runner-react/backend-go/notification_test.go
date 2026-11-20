package main

import (
	"strings"
	"testing"
)

func TestNotificationPolicy(t *testing.T) {
	e := notificationExecution{ID: "job", Name: "每日任务", Status: "success"}
	if got := executionNotification(e, normalizeNotification(nil), false); got != nil {
		t.Fatalf("default should suppress successful runs: %v", got)
	}
	c := normalizeNotification(map[string]any{
		"forward_output_on_success": true,
		"channels":                  "custom",
		"custom_channels":           []any{" Email ", "email", "invalid"},
	})
	if got := executionNotification(e, c, false); got != nil {
		t.Fatalf("empty output should be suppressed: %v", got)
	}
	e.Stdout = "中文输出\npassword=hide-me"
	got := executionNotification(e, c, false)
	if got["content"] != "中文输出\npassword=********" || strings.Join(got["channels"].([]string), ",") != "email" {
		t.Fatalf("unexpected notification: %v", got)
	}
	e.Status = "timeout"
	got = executionNotification(e, normalizeNotification(nil), false)
	if got["level"] != "error" {
		t.Fatalf("timeout should report failure: %v", got)
	}
	if _, exists := got["channels"]; exists {
		t.Fatalf("default routing must be resolved by the platform: %v", got)
	}
}
