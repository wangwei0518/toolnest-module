package main

import (
	"fmt"
	"maps"
	"math"
	"net/http"
	"slices"
)

var settingLimits = []struct {
	key, label string
	min, max   float64
}{
	{"max_file_size_mb", "最大附件大小", 1, 2048},
	{"temporary_resource_days", "临时资源有效期", 1, 365},
	{"temporary_resource_access_count", "临时资源最大访问次数", 1, 10000},
}

func notificationLevel(value any) bool {
	return value == "info" || value == "success" || value == "warning" || value == "error"
}

func notificationChannel(value string) string {
	switch value {
	case "in_app":
		return "web_internal"
	case "web_internal", "qqbot", "email", "webhook":
		return value
	default:
		return ""
	}
}

func normalizeNotificationRule(raw, fallback record, strict bool) (record, error) {
	enabled, level := fallback["enabled"], fallback["level"]
	channels := normalizeStrings(fallback["channels"])
	if value, exists := raw["enabled"]; exists {
		if _, ok := value.(bool); ok {
			enabled = value
		} else if strict {
			return nil, failure(422, "通知开关必须是布尔值")
		}
	}
	if value, exists := raw["level"]; exists {
		if notificationLevel(stringValue(value)) {
			level = stringValue(value)
		} else if strict {
			return nil, failure(422, "通知级别无效")
		}
	}
	values, validChannels := raw["channels"].([]any)
	if typed, ok := raw["channels"].([]string); ok {
		values = make([]any, len(typed))
		for i, channel := range typed {
			values[i] = channel
		}
		validChannels = true
	}
	if validChannels {
		selected := []string{}
		for _, value := range values {
			if _, ok := value.(string); !ok && strict {
				return nil, failure(422, "通知渠道必须是字符串数组")
			}
			key := notificationChannel(stringValue(value))
			if key == "" && strict {
				return nil, failure(422, "通知渠道包含不支持的类型")
			}
			if key != "" && !slices.Contains(selected, key) {
				selected = append(selected, key)
			}
		}
		if strict || len(selected) > 0 {
			channels = selected
		}
	} else if _, exists := raw["channels"]; exists && strict {
		return nil, failure(422, "通知渠道必须是字符串数组")
	}
	if strict && enabled == true && len(channels) == 0 {
		return nil, failure(422, "启用通知时至少选择一个通知渠道")
	}
	return record{"enabled": enabled, "level": level, "channels": channels}, nil
}

func fallbackRule() record {
	return record{"enabled": true, "level": "info", "channels": []string{"web_internal"}}
}

func (state *workflowState) normalizedSettings() record {
	defaults := newState().settings
	normalized := maps.Clone(state.settings)
	for _, limit := range settingLimits {
		number := numeric(state.settings[limit.key])
		normalized[limit.key] = defaults[limit.key]
		if number >= limit.min && number <= limit.max && math.Trunc(number) == number {
			normalized[limit.key] = number
		}
	}
	rules := maps.Clone(asRecord(defaults["notification_rules"]))
	for event, value := range asRecord(state.settings["notification_rules"]) {
		fallback := asRecord(defaultValue(rules[event], fallbackRule()))
		rules[event], _ = normalizeNotificationRule(asRecord(value), fallback, false)
	}
	normalized["notification_rules"] = rules
	return normalized
}

func (state *workflowState) updateSettings(body record) (record, error) {
	values := asRecord(defaultValue(body["values"], body))
	next := state.normalizedSettings()
	for _, limit := range settingLimits {
		if value, exists := values[limit.key]; exists {
			number := numeric(value)
			if !(number >= limit.min && number <= limit.max && math.Trunc(number) == number) {
				return nil, failure(422, fmt.Sprintf("%s必须是 %g–%g 之间的整数", limit.label, limit.min, limit.max))
			}
			next[limit.key] = number
		}
	}
	if raw, exists := values["notification_rules"]; exists {
		incoming := asRecord(raw)
		if incoming == nil {
			return nil, failure(422, "通知规则必须是对象")
		}
		rules := asRecord(next["notification_rules"])
		for event, value := range incoming {
			fallback := asRecord(defaultValue(rules[event], fallbackRule()))
			rule, err := normalizeNotificationRule(asRecord(value), fallback, true)
			if err != nil {
				return nil, err
			}
			rules[event] = rule
		}
	}
	state.settings = next
	return state.normalizedSettings(), nil
}

func (app *api) registerSettings(mux *http.ServeMux) {
	app.endpoint(mux, "GET /module-settings", false, func(state *workflowState, _ *http.Request, _ record) (any, error) {
		return state.normalizedSettings(), nil
	})
	app.endpoint(mux, "PUT /module-settings", true, func(state *workflowState, _ *http.Request, body record) (any, error) {
		return state.updateSettings(body)
	})
}
