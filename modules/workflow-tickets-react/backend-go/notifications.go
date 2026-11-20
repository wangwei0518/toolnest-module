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
	"slices"
	"strings"
	"time"
)

type notificationIntent struct {
	executionID string
	payload     record
}

type platformNotifications struct {
	base, token, moduleID string
}

var notificationHTTP = &http.Client{
	CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse },
}

func (client platformNotifications) request(ctx context.Context, method, suffix string, body record, timeout time.Duration) (record, error) {
	if client.base == "" || client.token == "" {
		return nil, fmt.Errorf("平台通知服务未配置")
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(raw)
	}
	address := strings.TrimRight(client.base, "/") + "/internal/modules/" + url.PathEscape(client.moduleID) + suffix
	request, err := http.NewRequestWithContext(ctx, method, address, reader)
	if err != nil {
		return nil, fmt.Errorf("平台通知服务地址无效")
	}
	request.Header.Set("X-ToolNest-Internal-Token", client.token)
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := notificationHTTP.Do(request)
	if err != nil {
		return nil, fmt.Errorf("无法连接平台通知服务")
	}
	defer response.Body.Close()
	var reply record
	decoder := json.NewDecoder(io.LimitReader(response.Body, 1<<20))
	decodeErr := decoder.Decode(&reply)
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("%s", stringOr(reply["message"], fmt.Sprintf("平台通知发送失败（%d）", response.StatusCode)))
	}
	if decodeErr != nil {
		return nil, fmt.Errorf("平台通知服务返回无效响应")
	}
	return asRecord(defaultValue(reply["data"], reply)), nil
}

func (client platformNotifications) provider(ctx context.Context) record {
	defaults := []string{"web_internal"}
	configured := []record{}
	if result, err := client.request(ctx, http.MethodGet, "/notification-channels", nil, 3*time.Second); err == nil {
		defaults = normalizeStrings(result["default_channels"])
		labels := map[string]string{"web_internal": "站内通知", "qqbot": "QQ 机器人", "email": "邮件", "webhook": "Webhook"}
		for _, item := range asRecords(result["channels"]) {
			channel := stringValue(item["key"])
			if labels[channel] != "" && item["configured"] == true && !slices.Contains(defaults, channel) {
				configured = append(configured, record{"key": channel, "label": stringOr(item["label"], labels[channel]), "configured": true})
			}
		}
	}
	return record{
		"key": "notification", "label": "平台通知", "description": "通过 ToolNest 通知中心投递，不在模块内直接保存或发送渠道凭据。",
		"events":                []string{"on_enter", "on_complete", "on_fail", "on_block"},
		"notification_channels": append([]record{{"key": "default", "label": "平台默认通知", "channels": defaults}}, configured...),
	}
}

func (state *workflowState) notifyTicket(event, title string, ticket record) {
	id := stringValue(ticket["id"])
	state.queueNotification(event, record{
		"title": title, "summary": ticket["number"], "content": stringOr(ticket["note"], title),
		"source_type": "ticket", "source_id": id, "related_url": "/modules/" + workflowModuleID + "/tickets/" + id,
	})
}

func (state *workflowState) queueNotification(event string, body record) {
	rule := asRecord(asRecord(state.normalizedSettings()["notification_rules"])[event])
	if rule != nil && !truthy(rule["enabled"]) {
		return
	}
	body["level"], body["event_type"] = stringOr(rule["level"], "info"), "workflow_tickets."+event
	if rule != nil {
		body["channels"] = rule["channels"]
	}
	state.notifications = append(state.notifications, notificationIntent{payload: body})
}

func (state *workflowState) executeNodeActions(ticket, node, definition record, event, now string) {
	for _, action := range asRecords(definition["actions"]) {
		key := stringOr(action["key"], stringValue(action["provider_key"]))
		if key != "notification" || action["event"] != event {
			continue
		}
		execution := record{
			"id": newID(), "ticket_id": ticket["id"], "node_id": node["node_id"], "provider_key": "notification",
			"event": event, "status": "failed", "input": action, "output": record{},
			"error": "通知尚未投递", "created_at": now, "completed_at": nil,
		}
		state.entities["action_executions"] = append(state.entities["action_executions"], execution)
		labels := map[string]string{"on_enter": "已进入", "on_complete": "已完成", "on_fail": "执行失败", "on_block": "已阻塞"}
		title := stringOr(action["label"], fmt.Sprintf("节点「%s」%s", node["name"], labels[event]))
		level := "info"
		switch event {
		case "on_complete":
			level = "success"
		case "on_fail", "on_block":
			level = "warning"
		}
		id := stringValue(ticket["id"])
		body := record{
			"title": title, "summary": ticket["number"], "content": stringOr(ticket["note"], title), "level": level,
			"event_type": "workflow_tickets.node_action." + event, "source_type": "ticket", "source_id": id,
			"related_url": "/modules/" + workflowModuleID + "/tickets/" + id,
		}
		if action["notification_channel_mode"] == "custom" {
			channels := slices.DeleteFunc(normalizeStrings(action["notification_channels"]), func(key string) bool {
				return notificationChannel(key) != key
			})
			if len(channels) == 0 {
				execution["error"], execution["completed_at"] = "节点动作未选择有效的通知渠道", now
				continue
			}
			body["channels"] = channels
		}
		state.notifications = append(state.notifications, notificationIntent{executionID: stringValue(execution["id"]), payload: body})
	}
}

func (repo *repository) deliverNotifications(ctx context.Context, intents []notificationIntent) {
	if len(intents) == 0 {
		return
	}
	// A canceled client request must not undo already committed changes.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 12*time.Second)
	defer cancel()
	results := map[string]record{}
	for _, intent := range intents {
		if intent.executionID == "" && repo.notifier.base == "" {
			continue
		}
		result, err := repo.notifier.request(ctx, http.MethodPost, "/notifications", intent.payload, 10*time.Second)
		if intent.executionID == "" {
			if err != nil {
				log.Printf("workflow notification delivery failed")
			}
			continue
		}
		outcome := record{"completed_at": timestamp(time.Now()), "status": "failed", "output": record{}, "error": nil}
		if err != nil {
			outcome["error"] = err.Error()
		} else {
			deliveries := []record{}
			for _, item := range asRecords(result["deliveries"]) {
				deliveries = append(deliveries, record{
					"channel": stringValue(defaultValue(item["channel"], item["channel_type"])), "status": stringValue(item["status"]),
				})
			}
			outcome["status"] = "succeeded"
			outcome["output"] = record{"notification_id": nullableString(result["notification_id"]), "deliveries": deliveries}
		}
		results[intent.executionID] = outcome
	}
	if len(results) == 0 {
		return
	}
	update, cancelUpdate := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
	defer cancelUpdate()
	if err := repo.update(update, func(state *workflowState) error {
		for _, item := range state.entities["action_executions"] {
			for key, value := range results[stringValue(item["id"])] {
				item[key] = value
			}
		}
		return nil
	}); err != nil {
		log.Printf("workflow notification execution update failed (%T)", err)
	}
}

func (app *api) registerActionProviders(mux *http.ServeMux) {
	mux.HandleFunc("GET /action-providers", func(w http.ResponseWriter, request *http.Request) {
		writeJSON(w, 200, record{"data": []record{app.notifier.provider(request.Context())}})
	})
}
