package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func exerciseWorkflowAPI(t *testing.T, repo *repository) {
	t.Helper()
	stopped := false
	dataDir := t.TempDir()
	var sentMu sync.Mutex
	sent := map[string]int{}
	platform := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-ToolNest-Internal-Token") != "test-token" {
			http.Error(w, "invalid module token", 401)
			return
		}
		switch r.URL.Path {
		case "/internal/modules/workflow-tickets-react/notification-channels":
			writeJSON(w, 200, record{"data": record{"default_channels": []string{"web_internal"}, "channels": []record{{"key": "email", "configured": true}}}})
		case "/internal/modules/workflow-tickets-react/notifications":
			var body record
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				http.Error(w, "invalid body", 400)
				return
			}
			sentMu.Lock()
			sent[stringValue(body["event_type"])]++
			sentMu.Unlock()
			writeJSON(w, 200, record{"notification_id": "test-notice", "deliveries": []record{{"channel": "web_internal", "status": "sent"}}})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(platform.Close)
	repo.notifier = platformNotifications{base: platform.URL, token: "test-token", moduleID: "workflow-tickets-react"}
	handler := newAPI(config{id: "workflow-tickets-react", release: "test-release", token: "test-token", dataDir: dataDir, platform: platform.URL}, repo, func() { stopped = true })
	call := func(method, path, body, token string, want int) record {
		t.Helper()
		request := httptest.NewRequest(method, path, strings.NewReader(body))
		request.Header.Set("X-ToolNest-Internal-Token", token)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != want {
			t.Fatalf("%s %s: code %d, want %d: %s", method, path, response.Code, want, response.Body)
		}
		var result record
		if response.Body.Len() != 0 {
			if err := decodeJSON(response.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
		}
		return result
	}
	const token = "test-token"
	providers := asRecords(call(http.MethodGet, "/action-providers", "", token, 200)["data"])
	if len(providers) != 1 || len(asRecords(providers[0]["notification_channels"])) != 2 {
		t.Fatalf("configured platform channels missing: %v", providers)
	}
	call(http.MethodGet, "/health/ready", "", "", 401)
	if ready := call(http.MethodGet, "/health/ready", "", token, 200); ready["release_id"] != "test-release" {
		t.Fatalf("unexpected readiness payload: %v", ready)
	}

	call(http.MethodPost, "/workflows", `{}`, token, 422)
	created := asRecord(call(http.MethodPost, "/workflows", `{"name":"工单迁移契约"}`, token, 200)["data"])
	firstID := stringValue(created["current_version_id"])
	path := "/workflows/" + stringValue(created["id"])
	call(http.MethodPut, path, `{"name":"无效编辑","edges":[{"source_node_id":"missing","target_node_id":"missing"}]}`, token, 422)
	current := asRecord(call(http.MethodGet, path, "", token, 200)["data"])
	if current["name"] != created["name"] || len(asRecords(current["versions"])) != 1 {
		t.Fatalf("invalid graph did not roll back: %v", current)
	}
	preview := asRecord(call(http.MethodPost, path+"/dry-run", `{"initial_values":{"context":"测试"}}`, token, 200)["data"])
	if preview["actions_executed"] != false || len(asRecords(preview["nodes"])) != 3 {
		t.Fatalf("unexpected preview: %v", preview)
	}
	call(http.MethodPut, "/module-settings", `{"temporary_resource_access_count":0}`, token, 422)
	moduleSettings := asRecord(call(http.MethodPut, "/module-settings", `{"values":{"temporary_resource_access_count":1,"notification_rules":{"node_completed":{"enabled":true,"channels":["in_app","email"]}}}}`, token, 200)["data"])
	channels := normalizeStrings(asRecord(asRecord(moduleSettings["notification_rules"])["node_completed"])["channels"])
	if fmt.Sprint(channels) != "[web_internal email]" {
		t.Fatalf("legacy channel aliases not preserved: %v", channels)
	}
	initialVersion := asRecords(current["versions"])[0]
	definitions := asRecords(initialVersion["nodes"])
	definitions[0]["actions"] = []record{{"key": "notification", "event": "on_fail", "label": "完成校验失败"}}
	schema := asRecord(definitions[1]["form_schema"])
	schema["fields"] = append(asRecords(schema["fields"]), record{
		"id": "script", "type": "script", "label": "处理记录",
		"config": record{"execution_template": "Source: {{ nodes.prepare.values.context }}"},
	})
	rawNodes, err := json.Marshal(record{"nodes": definitions})
	if err != nil {
		t.Fatal(err)
	}
	call(http.MethodPut, path, string(rawNodes), token, 200)
	call(http.MethodPost, path+"/publish", `{"publish_note":"初版"}`, token, 200)
	rule := asRecord(call(http.MethodPost, "/automations", `{"name":"阻塞标记","trigger":"ticket_blocked","enabled":true,"actions":[{"type":"set_priority","value":"high"},{"type":"add_tag","value":"关注"}]}`, token, 200)["data"])
	if rule["trigger"] != "node_blocked" {
		t.Fatalf("unexpected canonical trigger: %v", rule)
	}
	ticket := asRecord(call(http.MethodPost, "/tickets", `{"title":"月度巡检","workflow_id":"`+stringValue(created["id"])+`"}`, token, 200)["data"])
	ticketPath := "/tickets/" + stringValue(ticket["id"])
	nodes := asRecords(ticket["node_instances"])
	if len(nodes) != 3 || nodes[0]["status"] != "ready" || nodes[1]["status"] != "pending" {
		t.Fatalf("unexpected initial node states: %v", nodes)
	}
	nodePath := func(i int) string { return ticketPath + "/nodes/" + stringValue(nodes[i]["id"]) }
	call(http.MethodPost, nodePath(0)+"/complete", "", token, 422)
	failedForm := asRecord(call(http.MethodGet, ticketPath+"/diagnostics", "", token, 200)["data"])
	actions := asRecords(failedForm["actions"])
	if len(actions) != 1 || actions[0]["event"] != "on_fail" || actions[0]["status"] != "succeeded" {
		t.Fatalf("failed completion did not record notification outcome: %v", actions)
	}
	call(http.MethodPost, nodePath(0)+"/save", `{"values":{"context":"准备完成"}}`, token, 200)
	next := asRecord(call(http.MethodPost, nodePath(0)+"/complete", "", token, 200)["data"])
	if asRecords(next["node_instances"])[1]["status"] != "ready" {
		t.Fatalf("next node did not become ready: %v", next)
	}
	generated := asRecord(asRecord(asRecords(next["node_instances"])[1]["resources"])["script"])
	if generated["content"] != "Source: 准备完成" {
		t.Fatalf("prior node value did not render in the resource: %v", generated)
	}
	temporaryPath := strings.TrimPrefix(stringValue(generated["url"]), "/api/v1/modules/workflow-tickets-react")
	resourceResponse := httptest.NewRecorder()
	handler.ServeHTTP(resourceResponse, httptest.NewRequest(http.MethodGet, temporaryPath, nil))
	if resourceResponse.Code != 200 || resourceResponse.Body.String() != generated["content"] || resourceResponse.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("unexpected public resource response: %d", resourceResponse.Code)
	}
	call(http.MethodGet, temporaryPath, "", "", 404)
	call(http.MethodPost, nodePath(1)+"/save", `{"values":{"result":"处理完成"}}`, token, 200)
	call(http.MethodPost, nodePath(1)+"/complete", "", token, 200)
	call(http.MethodPost, nodePath(2)+"/complete", "", token, 422)
	call(http.MethodPost, nodePath(2)+"/save", `{"values":{"confirmed":true}}`, token, 200)
	completed := asRecord(call(http.MethodPost, nodePath(2)+"/complete", "", token, 200)["data"])
	if completed["status"] != "completed" {
		t.Fatalf("expected completed ticket: %v", completed)
	}
	reopened := asRecord(call(http.MethodPost, ticketPath+"/reopen", "", token, 200)["data"])
	if reopened["status"] != "in_progress" || asRecords(reopened["node_instances"])[2]["status"] != "ready" {
		t.Fatalf("completed ticket did not reopen at its last actionable node: %v", reopened)
	}
	call(http.MethodPost, nodePath(2)+"/rollback", `{"target_node_id":"`+stringValue(nodes[0]["id"])+`"}`, token, 422)
	rolledBack := asRecord(call(http.MethodPost, nodePath(2)+"/rollback", `{"target_node_id":"`+stringValue(nodes[1]["id"])+`"}`, token, 200)["data"])
	afterRollback := asRecords(rolledBack["node_instances"])
	if afterRollback[1]["status"] != "ready" || afterRollback[2]["status"] != "pending" {
		t.Fatalf("unexpected rolled back nodes: %v", afterRollback)
	}
	blocked := asRecord(call(http.MethodPost, nodePath(1)+"/block", `{"reason":"等待确认"}`, token, 200)["data"])
	if blocked["priority"] != "high" || fmt.Sprint(normalizeStrings(blocked["tags"])) != "[关注]" {
		t.Fatalf("automation changes missing: %v", blocked)
	}
	call(http.MethodPost, nodePath(1)+"/block", `{"reason":"重复阻塞"}`, token, 200)
	ruleActions := asRecords(call(http.MethodGet, "/automations/"+stringValue(rule["id"])+"/executions", "", token, 200)["data"])
	if len(ruleActions) != 1 || ruleActions[0]["status"] != "succeeded" {
		t.Fatalf("automation execution was not deduplicated: %v", ruleActions)
	}
	call(http.MethodPost, ticketPath+"/reopen", "", token, 200)
	call(http.MethodPost, nodePath(1)+"/complete", "", token, 200)
	call(http.MethodPost, nodePath(2)+"/save", `{"values":{"confirmed":true}}`, token, 200)
	call(http.MethodPost, nodePath(2)+"/complete", "", token, 200)
	page := asRecord(call(http.MethodGet, "/tickets?status=completed&keyword=月度&page_size=1", "", token, 200)["data"])
	if rows := asRecords(page["items"]); len(rows) != 1 || rows[0]["id"] != ticket["id"] {
		t.Fatalf("unexpected ticket page: %v", page)
	}
	draft := asRecord(call(http.MethodPost, path+"/versions", `{"change_note":"第二版"}`, token, 200)["data"])
	secondID := stringValue(draft["id"])
	call(http.MethodPut, path, `{"nodes":[{"id":"summary","name":"结果","node_type":"summary"}],"edges":[]}`, token, 200)
	compared := asRecord(call(http.MethodGet, path+"/versions/compare?base_version_id="+firstID+"&target_version_id="+secondID, "", token, 200)["data"])
	if len(asRecords(compared["added_nodes"])) != 1 || len(asRecords(compared["removed_nodes"])) != 3 {
		t.Fatalf("unexpected version diff: %v", compared)
	}
	final := asRecord(call(http.MethodPost, path+"/publish", "", token, 200)["data"])
	versions := asRecords(final["versions"])
	if len(versions) != 2 || versions[0]["status"] != "archived" || versions[1]["status"] != "published" || final["current_version_id"] != secondID {
		t.Fatalf("unexpected published versions: %v", versions)
	}
	past := time.Now().Add(-time.Minute).Truncate(time.Second)
	schedules := path + "/schedules"
	schedule := asRecord(call(http.MethodPost, schedules, fmt.Sprintf(`{"name":"过期补跑","schedule_type":"once","start_at":%q}`, timestamp(past)), token, 200)["data"])
	schedulePath := schedules + "/" + stringValue(schedule["id"])
	edited := asRecord(call(http.MethodPut, schedulePath, `{"name":"补跑任务"}`, token, 200)["data"])
	if edited["id"] != schedule["id"] || edited["next_run_at"] != schedule["next_run_at"] {
		t.Fatalf("editing lost scheduled occurrence: %v", edited)
	}
	if rows := asRecords(call(http.MethodGet, schedules, "", token, 200)["data"]); len(rows) != 1 {
		t.Fatalf("editing created a duplicate schedule: %v", rows)
	}
	// The worker does not depend on a page request and must be safe to
	// restart after the new ticket and schedule cursor have committed.
	for range 2 {
		ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
		err := runDueSchedules(ctx, repo, time.Now())
		cancel()
		if err != nil {
			t.Fatal(err)
		}
	}
	runs := asRecords(call(http.MethodGet, schedulePath+"/runs", "", token, 200)["data"])
	if len(runs) != 1 || runs[0]["status"] != "succeeded" || runs[0]["planned_at"] != timestamp(past) {
		t.Fatalf("unexpected scheduled runs: %v", runs)
	}
	automatic := asRecord(call(http.MethodGet, "/tickets/"+stringValue(runs[0]["ticket_id"]), "", token, 200)["data"])
	if automatic["created_by"] != scheduleActor || automatic["status"] != "completed" {
		t.Fatalf("unexpected scheduled ticket: %v", automatic)
	}
	call(http.MethodDelete, schedulePath, "", token, 200)
	call(http.MethodGet, schedulePath+"/runs", "", token, 404)
	t.Run("project and attachment workflow", func(t *testing.T) {
		project := asRecord(call(http.MethodPost, "/projects", `{"name":"迁移项目","goal":"保留历史数据"}`, token, 200)["data"])
		projectID := stringValue(project["id"])
		projectPath := "/projects/" + projectID
		past := timestamp(time.Now().Add(-time.Hour))
		milestone := asRecord(call(http.MethodPost, projectPath+"/milestones", fmt.Sprintf(`{"name":"验收","status":"active","target_at":%q}`, past), token, 200)["data"])
		milestoneID := stringValue(milestone["id"])
		if milestone["status"] != "in_progress" {
			t.Fatalf("legacy milestone status not normalized: %v", milestone)
		}
		call(http.MethodPost, path+"/versions", "", token, 200)
		call(http.MethodPut, path, `{"nodes":[{"id":"collect","form_schema":{"fields":[{"id":"proof","type":"image","config":{"max_size_mb":0.001}}]}}],"edges":[]}`, token, 200)
		call(http.MethodPost, path+"/publish", "", token, 200)
		item := asRecord(call(http.MethodPost, "/schedule-items", fmt.Sprintf(`{"title":"核对附件","reminder_at":%q}`, past), token, 200)["data"])
		itemPath := "/schedule-items/" + stringValue(item["id"])
		converted := asRecord(call(http.MethodPost, itemPath+"/convert", fmt.Sprintf(`{"workflow_id":%q,"project_id":%q,"milestone_id":%q}`, created["id"], projectID, milestoneID), token, 200)["data"])
		newTicketPath := "/tickets/" + stringValue(converted["id"])
		call(http.MethodPost, itemPath+"/convert", `{}`, token, 409)
		call(http.MethodPost, itemPath+"/archive", "", token, 409)
		for range 2 {
			if err := runBackgroundReminders(context.Background(), repo, time.Now()); err != nil {
				t.Fatal(err)
			}
		}
		sentMu.Lock()
		for _, event := range []string{"ticket_reminder", "milestone_due", "project_risk"} {
			if count := sent["workflow_tickets."+event]; count != 1 {
				t.Errorf("%s sent %d times, want once", event, count)
			}
		}
		sentMu.Unlock()
		analytics := asRecord(call(http.MethodGet, projectPath+"/analytics", "", token, 200)["data"])
		if len(asRecords(analytics["trend"])) != 14 || asRecord(analytics["project"])["current_milestone_id"] != milestoneID || converted["milestone_name"] != "验收" {
			t.Fatalf("project or milestone link not reflected in response: %v", analytics)
		}
		resource := asRecord(call(http.MethodPost, "/resources", fmt.Sprintf(`{"name":"验收文档","type":"link","url":"https://example.invalid/docs","project_id":%q,"ticket_ids":[%q],"milestone_ids":[%q]}`, projectID, converted["id"], milestoneID), token, 200)["data"])
		if resource["type"] != "custom" || len(asRecords(call(http.MethodGet, "/resources?milestone_id="+milestoneID, "", token, 200)["data"])) != 1 {
			t.Fatalf("resource links were not normalized: %v", resource)
		}
		call(http.MethodGet, "/timeline?aggregate=day&since=invalid", "", token, 400)
		activity := asRecord(call(http.MethodGet, "/timeline?aggregate=day&timezone=Asia%2FShanghai&project_id="+projectID, "", token, 200)["data"])
		if len(asRecords(activity["days"])) == 0 {
			t.Fatalf("project activities were not returned: %v", activity)
		}
		upload := func(data string, want int) record {
			t.Helper()
			var buffer bytes.Buffer
			writer := multipart.NewWriter(&buffer)
			if err := writer.WriteField("field_id", "proof"); err != nil {
				t.Fatal(err)
			}
			part, err := writer.CreateFormFile("file", "证据.png")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := part.Write([]byte(data)); err != nil {
				t.Fatal(err)
			}
			if err := writer.Close(); err != nil {
				t.Fatal(err)
			}
			request := httptest.NewRequest(http.MethodPost, newTicketPath+"/nodes/collect/attachments", &buffer)
			request.Header.Set("X-ToolNest-Internal-Token", token)
			request.Header.Set("Content-Type", writer.FormDataContentType())
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != want {
				t.Fatalf("upload returned %d, want %d: %s", response.Code, want, response.Body)
			}
			var result record
			if err := decodeJSON(response.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			return asRecord(result["data"])
		}
		upload(strings.Repeat("a", 2048), 413)
		if files, err := os.ReadDir(filepath.Join(dataDir, "attachments")); err != nil || len(files) != 0 {
			t.Fatalf("rejected upload left files: %v, %v", files, err)
		}
		file := upload("original-image-bytes", 200)
		attachmentPath := "/attachments/" + stringValue(file["id"])
		request := httptest.NewRequest(http.MethodGet, attachmentPath, nil)
		request.Header.Set("X-ToolNest-Internal-Token", token)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != 200 || response.Body.String() != "original-image-bytes" {
			t.Fatalf("stored attachment did not round trip: %d, %s", response.Code, response.Body)
		}
		backup := asRecord(call(http.MethodGet, "/data/export", "", token, 200)["data"])
		files := asRecords(asRecord(backup["data"])["attachments"])
		if len(files) != 1 || files[0]["content_base64"] != "b3JpZ2luYWwtaW1hZ2UtYnl0ZXM=" {
			t.Fatalf("attachment was not included in the backup: %v", files)
		}
		call(http.MethodPost, "/data/import", `{"mode":"replace"}`, token, 422)
		call(http.MethodPost, "/data/import", `{"mode":"replace","confirm":true,"data":{"attachments":[{"filename":"broken.txt","content_base64":"!!!"}]}}`, token, 422)
		if files, err := os.ReadDir(filepath.Join(dataDir, "attachments")); err != nil || len(files) != 1 {
			t.Fatalf("invalid replacement changed stored files: %v, %v", files, err)
		}
		backupData, err := json.Marshal(record{"mode": "replace", "confirm": true, "data": record{"attachments": files}})
		if err != nil {
			t.Fatal(err)
		}
		call(http.MethodPost, "/data/import", string(backupData), token, 200)
		response = httptest.NewRecorder()
		handler.ServeHTTP(response, request.Clone(context.Background()))
		if response.Code != 200 || response.Body.String() != "original-image-bytes" {
			t.Fatalf("attachment was not restored from the backup: %d, %s", response.Code, response.Body)
		}
		call(http.MethodPut, newTicketPath, fmt.Sprintf(`{"related_ticket_ids":[%q]}`, converted["id"]), token, 422)
		call(http.MethodPut, newTicketPath, `{"title":"核对通过"}`, token, 200)
		call(http.MethodPost, newTicketPath+"/nodes/collect/save", `{"values":{"password":"must-mask"}}`, token, 200)
		diagnostics := asRecord(call(http.MethodGet, newTicketPath+"/diagnostics", "", token, 200)["data"])
		if asRecord(asRecords(diagnostics["nodes"])[0]["values"])["password"] != "******" {
			t.Fatalf("diagnostics did not mask sensitive form values: %v", diagnostics)
		}
		call(http.MethodDelete, projectPath+"/milestones/"+milestoneID, "", token, 200)
		updated := asRecord(call(http.MethodGet, newTicketPath, "", token, 200)["data"])
		if updated["milestone_id"] != nil || updated["title"] != "核对通过" || len(asRecords(updated["attachments"])) != 1 {
			t.Fatalf("unexpected updated ticket: %v", updated)
		}
		call(http.MethodDelete, newTicketPath, "", token, 200)
		call(http.MethodGet, attachmentPath, "", token, 404)
		if files, err := os.ReadDir(filepath.Join(dataDir, "attachments")); err != nil || len(files) != 0 {
			t.Fatalf("deleting the ticket did not clean up the attachment: %v, %v", files, err)
		}
		resourceList := asRecords(call(http.MethodGet, "/resources?project_id="+projectID, "", token, 200)["data"])
		if len(resourceList) != 1 || len(array(resourceList[0]["ticket_ids"])) != 0 || len(array(resourceList[0]["milestone_ids"])) != 0 {
			t.Fatalf("resource links were not cleared: %v", resourceList)
		}
	})
	call(http.MethodPost, "/saved-views", `{"name":"第一个视图","is_default":true}`, token, 200)
	defaultView := asRecord(call(http.MethodPost, "/saved-views", `{"name":"第二个视图","is_default":true}`, token, 200)["data"])
	for _, item := range asRecords(call(http.MethodGet, "/saved-views", "", token, 200)["data"]) {
		if item["is_default"] != (item["id"] == defaultView["id"]) {
			t.Fatalf("more than one default view: %v", item)
		}
	}
	call(http.MethodPost, path+"/archive", "", token, 200)
	list := asRecords(call(http.MethodGet, "/workflows?keyword=工单迁移契约", "", token, 200)["data"])
	if len(list) != 0 {
		t.Fatalf("archived workflow appeared in list: %v", list)
	}
	call(http.MethodPost, "/health/shutdown", "", "", 401)
	if stopped {
		t.Fatal("unauthorized shutdown succeeded")
	}
	call(http.MethodPost, "/health/shutdown", "", token, 204)
	if !stopped {
		t.Fatal("authenticated shutdown did not signal")
	}
	if err := repo.read(context.Background(), func(state *workflowState) error {
		if len(state.entities["tickets"]) != 3 || findRecord(state.entities["tickets"], "legacy-only") == nil {
			t.Fatal("imported ticket was not retained")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}
