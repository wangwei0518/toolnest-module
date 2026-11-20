package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
)

func testAPI(t *testing.T) (*api, http.Handler) {
	t.Helper()
	cfg := config{id: "temporary-transfer", release: "test", token: "test-internal-token", dataDir: t.TempDir()}
	store, err := openStore(t.Context(), cfg.dataDir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.db.Close() })
	api, err := newAPI(cfg, store)
	if err != nil {
		t.Fatal(err)
	}
	return api, authenticated(cfg, api.handler(), func() {})
}

type testClient struct {
	handler http.Handler
	t       *testing.T
}

func (c testClient) request(method, url, owner string, data any) *httptest.ResponseRecorder {
	var body []byte
	var kind string
	if raw, ok := data.([]byte); ok {
		body, kind = raw, "application/octet-stream"
	} else if data != nil {
		var err error
		body, err = json.Marshal(data)
		if err != nil {
			c.t.Fatal(err)
		}
		kind = "application/json"
	}
	r := httptest.NewRequest(method, strings.TrimPrefix(url, "/api/v1/modules/temporary-transfer"), bytes.NewReader(body))
	r.Header.Set("X-ToolNest-Internal-Token", "test-internal-token")
	if kind != "" {
		r.Header.Set("Content-Type", kind)
	}
	if owner != "" {
		r.Header.Set("X-ToolNest-User-Id", owner)
	}
	out := httptest.NewRecorder()
	c.handler.ServeHTTP(out, r)
	return out
}
func (c testClient) json(status int, method, url, owner string, data any) map[string]any {
	c.t.Helper()
	response := c.request(method, url, owner, data)
	if response.Code != status {
		c.t.Fatalf("%s %s: got %d want %d (%s)", method, url, response.Code, status, response.Body.String())
	}
	if status == 204 {
		return nil
	}
	var result map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		c.t.Fatal(err)
	}
	return result
}

func TestRuntimeAuthOwnerPickupAndRevocation(t *testing.T) {
	_, handler := testAPI(t)
	c := testClient{handler, t}
	for _, route := range []string{"/health/ready", "/transfers", "/public/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"} {
		out := httptest.NewRecorder()
		handler.ServeHTTP(out, httptest.NewRequest("GET", route, nil))
		if out.Code != 401 {
			t.Fatalf("%s was accessible without internal token", route)
		}
	}
	if !c.json(200, "GET", "/health/ready", "", nil)["ready"].(bool) {
		t.Fatal("readiness missing")
	}
	c.json(401, "GET", "/transfers", "", nil)
	c.json(403, "PUT", "/transfer-settings", "1", map[string]any{})
	item := c.json(201, "POST", "/transfers", "1", map[string]any{"kind": "text", "title": "测试", "content": "跨设备测试", "durationMinutes": 90})
	if delta := item["expiresAt"].(float64) - item["createdAt"].(float64); delta < 5399000 || delta > 5400000 {
		t.Fatalf("wrong expiry %f", delta)
	}
	id := item["id"].(string)
	code := item["code"]
	c.json(404, "GET", "/transfers/"+id+"/content", "2", nil)
	result := c.json(200, "POST", "/pickup", "2", map[string]any{"code": item["pickupCode"]})
	if result["id"] != id || result["content"] != "跨设备测试" || result["pin"] != nil {
		t.Fatalf("unexpected pickup result %+v", result)
	}
	apiPath := "/public/" + id + "/verify"
	c.json(200, "POST", apiPath, "", map[string]any{"code": code})
	rotated := c.json(200, "POST", "/transfers/"+id+"/code", "1", map[string]any{})
	if rotated["pickupCode"] == item["pickupCode"] {
		t.Fatal("pickup code did not rotate")
	}
	c.json(403, "POST", "/pickup", "2", map[string]any{"code": item["pickupCode"]})
	c.json(200, "DELETE", "/transfers/"+id, "1", nil)
	c.json(403, "POST", apiPath, "", map[string]any{"code": rotated["code"]})
}

func TestLocalResumeDownloadRangeAndCleanup(t *testing.T) {
	a, handler := testAPI(t)
	c := testClient{handler, t}
	item := c.json(201, "POST", "/transfers", "1", map[string]any{"kind": "files", "title": "附件", "hours": 1, "maxGrants": 1})
	id := item["id"].(string)
	const fileID = "b562823d-778c-4f47-b0ff-bafb35be0e00"
	content := bytes.Repeat([]byte{0x7b}, int(partSize)+31)
	prefix := "/transfers/" + id
	meta := map[string]any{"clientId": fileID, "filename": "示例.bin", "size": len(content)}
	c.json(201, "POST", prefix+"/files", "1", meta)
	c.json(200, "POST", prefix+"/files", "1", meta)
	path := prefix + "/files/" + fileID
	unauth := c.json(400, "POST", path+"/parts/1", "2", map[string]any{})
	if unauth["message"] == nil {
		t.Fatal("missing rejection")
	}
	for i, index := range []string{"1", "2"} {
		signed := c.json(200, "POST", path+"/parts/"+index, "1", map[string]any{})["url"].(string)
		b := content[i*int(partSize) : min(len(content), (i+1)*int(partSize))]
		if i == 0 {
			c.json(400, "PUT", signed, "", b[:len(b)-1])
		}
		c.json(204, "PUT", signed, "", b)
		parts := c.json(200, "GET", path+"/parts", "1", nil)["parts"].([]any)
		if len(parts) != i+1 {
			t.Fatalf("got %d parts", len(parts))
		}
	}
	c.json(200, "POST", path+"/complete", "1", map[string]any{})
	c.json(200, "POST", prefix+"/publish", "1", map[string]any{})
	grant := c.json(200, "POST", "/public/"+id+"/files/"+fileID+"/download", "", map[string]any{"code": item["code"]})["url"].(string)
	c.json(404, "POST", path+"/download", "1", map[string]any{})
	out := c.request("GET", grant, "", nil)
	if out.Code != 200 || !bytes.Equal(out.Body.Bytes(), content) {
		t.Fatal("download changed bytes")
	}
	request := httptest.NewRequest("GET", strings.TrimPrefix(grant, "/api/v1/modules/temporary-transfer"), nil)
	request.Header.Set("X-ToolNest-Internal-Token", "test-internal-token")
	request.Header.Set("Range", "bytes=1-8")
	ranged := httptest.NewRecorder()
	handler.ServeHTTP(ranged, request)
	if ranged.Code != 206 || !bytes.Equal(ranged.Body.Bytes(), content[1:9]) {
		t.Fatalf("invalid range response %d", ranged.Code)
	}
	c.json(200, "DELETE", prefix, "1", nil)
	c.json(404, "GET", grant, "", nil)
	if err := a.cleanup(context.Background()); err != nil {
		t.Fatal(err)
	}
	used, err := usage(t.Context(), a.store.db)
	if err != nil || used != 0 {
		t.Fatalf("cleanup failed: %d %v", used, err)
	}
}

func TestConcurrentGrantCannotExceedQuota(t *testing.T) {
	a, handler := testAPI(t)
	c := testClient{handler, t}
	item := c.json(201, "POST", "/transfers", "1", map[string]any{"kind": "files", "title": "测试", "maxGrants": 1})
	id := item["id"].(string)
	fileID := "b562823d-778c-4f47-b0ff-bafb35be0e02"
	c.json(201, "POST", "/transfers/"+id+"/files", "1", map[string]any{"clientId": fileID, "filename": "空", "size": 0})
	c.json(200, "POST", "/transfers/"+id+"/publish", "1", map[string]any{})
	var wg sync.WaitGroup
	grants := make(chan bool, 6)
	for i := 0; i < cap(grants); i++ {
		wg.Go(func() {
			ok, err := a.store.claimGrant(t.Context(), id, fileID, item["code"].(string))
			if err != nil {
				t.Error(err)
			}
			grants <- ok
		})
	}
	wg.Wait()
	close(grants)
	count := 0
	for ok := range grants {
		if ok {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("issued %d grants", count)
	}
}

func TestGuestPageNonceAndExistingSignedToken(t *testing.T) {
	a, handler := testAPI(t)
	c := testClient{handler, t}
	page := c.request("GET", "/public/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "", nil)
	if page.Code != 200 || !strings.Contains(page.Header().Get("Content-Security-Policy"), "frame-ancestors 'none'") {
		t.Fatalf("guest CSP missing: %v", page.Header())
	}
	link, err := a.local.signPart(t.Context(), "transfers/test/test", strings.Repeat("a", 32), 1, 12)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(link)
	if err != nil {
		t.Fatal(err)
	}
	token := parsed.Query().Get("token")
	claim, ok := a.local.verify(token)
	if !ok || claim.Size != 12 {
		t.Fatal("unexpected token claim")
	}
	if _, ok := a.local.verify(token + ".invalid"); ok {
		t.Fatal("invalid token accepted")
	}
}
func TestSettingsRestoreSecretsAndProtectExistingR2Files(t *testing.T) {
	a, handler := testAPI(t)
	call := func(method string, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "/transfer-settings", strings.NewReader(body))
		r.Header.Set("X-ToolNest-Internal-Token", "test-internal-token")
		r.Header.Set("X-ToolNest-User-Id", "1")
		r.Header.Set("X-ToolNest-User-Is-Admin", "true")
		r.Header.Set("Content-Type", "application/json")
		out := httptest.NewRecorder()
		handler.ServeHTTP(out, r)
		return out
	}
	configured := call("PUT", `{"defaultHours":12,"r2":{"accountId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","bucket":"example","accessKeyId":"test-private-id","secretAccessKey":"test-private-secret"}}`)
	if configured.Code != 200 || strings.Contains(configured.Body.String(), "test-private") {
		t.Fatalf("settings save or masking failed (%d)", configured.Code)
	}
	updated := call("PUT", `{"r2":{"accessKeyId":"","secretAccessKey":""}}`)
	if updated.Code != 200 {
		t.Fatalf("keeping existing credentials failed (%d)", updated.Code)
	}
	restored, err := loadSettings(a.cfg.dataDir)
	if err != nil || restored.DefaultHours != 12 || restored.R2 == nil || restored.R2.SecretAccessKey != "test-private-secret" {
		t.Fatal("settings failed to survive restart")
	}
	item, err := a.store.create(t.Context(), "1", "reserve", "files", nil, nowMS()+60000, nil, restored.MaxTotalBytes)
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = a.store.addFile(t.Context(), "1", item["id"].(string), "file", "upload", 1, restored.MaxTotalBytes, "r2")
	if err != nil {
		t.Fatal(err)
	}
	if out := call("PUT", `{"r2":null}`); out.Code != 400 || !strings.Contains(out.Body.String(), "暂存空间中仍有文件") {
		t.Fatal("configuration detached existing R2 objects")
	}
}

func TestExpiredTransferClosesAccessAndPurgeErasesContent(t *testing.T) {
	a, handler := testAPI(t)
	content := "保密内容"
	item, err := a.store.create(t.Context(), "1", "保密标题", "text", &content, nowMS()-1, nil, defaultSettings.MaxTotalBytes)
	if err != nil {
		t.Fatal(err)
	}
	id := item["id"].(string)
	testClient{handler, t}.json(403, "POST", "/public/"+id+"/verify", "", map[string]any{"code": item["code"]})
	if err := a.cleanup(t.Context()); err != nil {
		t.Fatal(err)
	}
	var title string
	var body *string
	if err := a.store.db.QueryRowContext(t.Context(), "SELECT title,text_content FROM transfers WHERE id=?", id).Scan(&title, &body); err != nil {
		t.Fatal(err)
	}
	if body != nil || title != "已清理的投递" {
		t.Fatal("expired metadata not cleared")
	}
}
