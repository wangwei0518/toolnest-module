package main

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"io"
	"log"
	"math"
	"mime"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode/utf16"
)

type requestError struct {
	status  int
	message string
}

func (e requestError) Error() string               { return e.message }
func clientError(status int, message string) error { return requestError{status, message} }

func respondError(w http.ResponseWriter, err error) {
	var expected requestError
	switch {
	case errors.As(err, &expected):
		writeJSON(w, expected.status, map[string]string{"message": expected.message})
	case errors.Is(err, syscall.ENOSPC):
		writeJSON(w, 507, map[string]string{"message": "服务器磁盘空间不足，请联系管理员清理。"})
	default:
		// SDK and filesystem errors can contain signed URLs, keys or private paths.
		log.Printf("文件邮局请求失败 (%T)", err)
		writeJSON(w, 500, map[string]string{"message": "请求失败，请稍后重试"})
	}
}

type api struct {
	cfg                                                config
	store                                              *transferStore
	local                                              *localStorage
	settingsMu                                         sync.RWMutex
	settings                                           transferSettings
	r2                                                 objectStorage
	fileLocks                                          [128]sync.Mutex
	localUploadSlots                                   chan struct{}
	guestLimiter, pickupLimiter, pickupDownloadLimiter *limiter
	cryptoSlots                                        chan struct{}
}

func newAPI(cfg config, store *transferStore) (*api, error) {
	settings, err := loadSettings(cfg.dataDir)
	if err != nil {
		return nil, err
	}
	local, err := newLocalStorage(cfg.dataDir)
	if err != nil {
		return nil, err
	}
	a := &api{cfg: cfg, store: store, local: local, settings: settings, localUploadSlots: make(chan struct{}, 8),
		guestLimiter: newLimiter(8), pickupLimiter: newLimiter(8), pickupDownloadLimiter: newLimiter(60),
		cryptoSlots: make(chan struct{}, 4)}
	if settings.R2 != nil {
		a.r2 = newR2(*settings.R2, settings.R2.endpoint(), http.DefaultClient)
	}
	return a, nil
}

func (a *api) currentSettings() transferSettings {
	a.settingsMu.RLock()
	defer a.settingsMu.RUnlock()
	return a.settings
}

func (a *api) storage(backend string) (objectStorage, error) {
	if backend == "local" {
		return a.local, nil
	}
	a.settingsMu.RLock()
	defer a.settingsMu.RUnlock()
	if backend == "r2" && a.r2 != nil {
		return a.r2, nil
	}
	return nil, clientError(400, "尚未配置 R2 存储")
}

func (a *api) fileLock(id string) *sync.Mutex {
	hash := sha256.Sum256([]byte(id))
	return &a.fileLocks[int(hash[0])%len(a.fileLocks)]
}

type endpoint func(http.ResponseWriter, *http.Request, string) error

var ownerPattern = regexp.MustCompile("^[0-9]{1,20}$")
var transferIDPattern = regexp.MustCompile("^[A-Za-z0-9_-]{32}$")
var clientIDPattern = regexp.MustCompile("(?i)^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")

func (a *api) handler() http.Handler {
	mux := http.NewServeMux()
	add := func(pattern string, requiresOwner bool, handler endpoint) {
		mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
			var owner string
			if requiresOwner {
				owner = r.Header.Get("X-ToolNest-User-Id")
				if !ownerPattern.MatchString(owner) {
					respondError(w, clientError(401, "无法识别登录用户"))
					return
				}
			}
			if err := handler(w, r, owner); err != nil {
				respondError(w, err)
			}
		})
	}
	add("GET /transfer-settings", true, a.getSettings)
	add("PUT /transfer-settings", true, a.putSettings)
	add("GET /transfers", true, a.listTransfers)
	add("POST /transfers", true, a.createTransfer)
	add("POST /transfers/{id}/code", true, a.rotateCode)
	add("GET /transfers/{id}/share", true, a.shareCode)
	add("DELETE /transfers/{id}", true, a.revoke)
	add("POST /transfers/{id}/files", true, a.addFile)
	add("GET /transfers/{id}/files/{file}/parts", true, a.listParts)
	add("POST /transfers/{id}/files/{file}/parts/{part}", true, a.signPart)
	add("POST /transfers/{id}/files/{file}/complete", true, a.completeFile)
	add("POST /transfers/{id}/publish", true, a.publish)
	add("GET /transfers/{id}/content", true, a.ownedContent)
	add("POST /transfers/{id}/files/{file}/download", true, a.ownerDownload)
	add("POST /pickup", true, a.pickup)
	add("POST /pickup/{id}/files/{file}/download", true, a.pickupDownload)
	add("PUT /public/local-upload", false, a.localUpload)
	add("GET /public/local-download", false, a.localDownload)
	add("GET /public/assets/{asset}", false, a.guestAsset)
	add("GET /public/{id}", false, a.guestPage)
	add("POST /public/{id}/verify", false, a.guestVerify)
	add("POST /public/{id}/files/{file}/download", false, a.guestDownload)
	return mux
}

func readBody(w http.ResponseWriter, r *http.Request) (map[string]json.RawMessage, error) {
	media, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if media != "application/json" {
		return nil, clientError(400, "请求格式无效")
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return nil, clientError(413, "请求格式无效")
		}
		return nil, clientError(400, "请求格式无效")
	}
	var value map[string]json.RawMessage
	if err = json.Unmarshal(data, &value); err != nil || value == nil {
		return nil, clientError(400, "请求格式无效")
	}
	return value, nil
}

func parseText(raw json.RawMessage, maxLen int) (string, error) {
	var s string
	if len(raw) == 0 || isNull(raw) || json.Unmarshal(raw, &s) != nil || len(utf16.Encode([]rune(s))) > maxLen {
		return "", clientError(400, "输入内容无效")
	}
	return s, nil
}

func parseInteger(raw json.RawMessage, lo, hi int64) (int64, error) {
	var n float64
	if len(raw) == 0 || isNull(raw) || json.Unmarshal(raw, &n) != nil || math.Trunc(n) != n || n < float64(lo) || n > float64(hi) {
		return 0, clientError(400, "输入数值超出允许范围")
	}
	return int64(n), nil
}

func privateJSON(w http.ResponseWriter, value any) error {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, value)
	return nil
}

func okJSON(w http.ResponseWriter) error {
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}

func (a *api) lockCrypto() (func(), error) {
	select {
	case a.cryptoSlots <- struct{}{}:
		return func() { <-a.cryptoSlots }, nil
	default:
		return nil, clientError(429, "尝试过于频繁，请稍后再试")
	}
}

func adminHeaders(r *http.Request) (bool, bool) {
	_, present := r.Header["X-Toolnest-User-Is-Admin"]
	return present, r.Header.Get("X-Toolnest-User-Is-Admin") == "true"
}

func (a *api) getSettings(w http.ResponseWriter, r *http.Request, _ string) error {
	present, admin := adminHeaders(r)
	public := a.currentSettings().public(present, admin)
	public["publicBaseUrl"] = a.publicURL(r.Context())
	writeJSON(w, 200, public)
	return nil
}

func (a *api) publicURL(ctx context.Context) string {
	if a.cfg.platform == "" {
		return ""
	}
	deadline, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(deadline, http.MethodGet, strings.TrimRight(a.cfg.platform, "/")+"/internal/modules/"+url.PathEscape(a.cfg.id)+"/public-url", nil)
	if err != nil {
		return ""
	}
	req.Header.Set("X-ToolNest-Internal-Token", a.cfg.token)
	client := http.Client{CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return ""
	}
	var result struct {
		Data struct {
			URL string `json:"public_base_url"`
		} `json:"data"`
	}
	if json.NewDecoder(io.LimitReader(resp.Body, 32<<10)).Decode(&result) != nil {
		return ""
	}
	parsed, err := url.Parse(result.Data.URL)
	if err != nil || parsed.Host == "" || parsed.User != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return ""
	}
	parsed.RawQuery, parsed.Fragment, parsed.ForceQuery = "", "", false
	return strings.TrimSuffix(parsed.String(), "/")
}

func (a *api) putSettings(w http.ResponseWriter, r *http.Request, _ string) error {
	present, admin := adminHeaders(r)
	if !present {
		return clientError(403, "宿主未传递管理员身份，请升级或重启 ToolNest 宿主后端。")
	}
	if !admin {
		return clientError(403, "仅管理员可以修改配置")
	}
	input, err := readBody(w, r)
	if err != nil {
		return err
	}
	raw, err := json.Marshal(input)
	if err != nil {
		return err
	}
	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()
	next, err := decodeSettings(a.settings, raw, false)
	if err != nil {
		return err
	}
	hasFiles, err := a.store.hasR2Files(r.Context())
	if err != nil {
		return err
	}
	if hasFiles && (next.R2 == nil || a.settings.R2 == nil || next.R2.AccountID != a.settings.R2.AccountID || next.R2.Bucket != a.settings.R2.Bucket) {
		return clientError(400, "暂存空间中仍有文件，请先清理后再更换存储桶")
	}
	if err = saveSettings(a.cfg.dataDir, next); err != nil {
		return err
	}
	a.settings = next
	a.r2 = nil
	if next.R2 != nil {
		a.r2 = newR2(*next.R2, next.R2.endpoint(), http.DefaultClient)
	}
	writeJSON(w, 200, next.public(true, true))
	return nil
}

func (a *api) listTransfers(w http.ResponseWriter, r *http.Request, owner string) error {
	offset := int64(0)
	var err error
	if raw := strings.TrimSpace(r.URL.Query().Get("offset")); raw != "" {
		offset, err = strconv.ParseInt(raw, 10, 64)
		if err != nil || offset < 0 || offset > 1000000 {
			return clientError(400, "输入数值超出允许范围")
		}
	}
	result, err := a.store.list(r.Context(), owner, offset)
	if err != nil {
		return err
	}
	result["maxBytes"] = a.currentSettings().MaxTotalBytes
	writeJSON(w, 200, result)
	return nil
}

func (a *api) createTransfer(w http.ResponseWriter, r *http.Request, owner string) error {
	input, err := readBody(w, r)
	if err != nil {
		return err
	}
	title, err := parseText(input["title"], 180)
	if err != nil {
		return err
	}
	title = strings.TrimSpace(title)
	if title == "" {
		title = "临时投递"
	}
	settings := a.currentSettings()
	minutes := settings.DefaultHours * 60
	if value, present := input["durationMinutes"]; present {
		minutes, err = parseInteger(value, 1, settings.MaxHours*60)
	} else if value, present := input["hours"]; present && !isNull(value) {
		var hours int64
		hours, err = parseInteger(value, 1, settings.MaxHours)
		minutes = hours * 60
	}
	if err != nil {
		return err
	}
	maxGrants := settings.DefaultMaxGrants
	if value, present := input["maxGrants"]; present {
		maxGrants = nil
		if !isNull(value) {
			n, err := parseInteger(value, 1, settings.MaxGrantsAllowed)
			if err != nil {
				return err
			}
			maxGrants = &n
		}
	}
	kind, _ := parseText(input["kind"], 8)
	var content *string
	switch kind {
	case "text":
		value, err := parseText(input["content"], 100000)
		if err != nil {
			return err
		}
		if strings.TrimSpace(value) == "" {
			return clientError(400, "输入内容不能为空")
		}
		content = &value
	case "files":
	default:
		return clientError(400, "输入类型无效")
	}
	release, err := a.lockCrypto()
	if err != nil {
		return err
	}
	defer release()
	result, err := a.store.create(r.Context(), owner, title, kind, content, nowMS()+minutes*60000, maxGrants, settings.MaxTotalBytes)
	if err != nil {
		return err
	}
	writeJSON(w, 201, result)
	return nil
}

func (a *api) rotateCode(w http.ResponseWriter, r *http.Request, owner string) error {
	release, err := a.lockCrypto()
	if err != nil {
		return err
	}
	defer release()
	id := r.PathValue("id")
	code, err := a.store.rotate(r.Context(), owner, id)
	if err != nil {
		return err
	}
	if code == "" {
		return clientError(404, "投递不存在或已失效")
	}
	_, pickup, err := a.store.share(r.Context(), owner, id)
	if err != nil {
		return err
	}
	var value any
	if pickup != "" {
		value = pickup
	}
	return privateJSON(w, map[string]any{"code": code, "pickupCode": value})
}
func (a *api) shareCode(w http.ResponseWriter, r *http.Request, owner string) error {
	release, err := a.lockCrypto()
	if err != nil {
		return err
	}
	defer release()
	pin, pickup, err := a.store.share(r.Context(), owner, r.PathValue("id"))
	if err != nil {
		return err
	}
	if pin == "" {
		return clientError(404, "分享信息不可用，请重新生成提取码")
	}
	return privateJSON(w, map[string]string{"code": pin, "pickupCode": pickup})
}
func (a *api) revoke(w http.ResponseWriter, r *http.Request, owner string) error {
	ok, err := a.store.revoke(r.Context(), owner, r.PathValue("id"))
	if err != nil {
		return err
	}
	if !ok {
		return clientError(404, "投递不存在或已撤销")
	}
	return okJSON(w)
}
func (a *api) publish(w http.ResponseWriter, r *http.Request, owner string) error {
	ok, err := a.store.publish(r.Context(), owner, r.PathValue("id"))
	if err != nil {
		return err
	}
	if !ok {
		return clientError(409, "投递尚未完成上传或已失效")
	}
	return okJSON(w)
}

// Keep a bounded number of rolling one-minute attempt buckets.
type attempt struct {
	count int
	until int64
}
type limiter struct {
	mu     sync.Mutex
	keys   map[string]attempt
	global attempt
	perKey int
}

func newLimiter(perKey int) *limiter { return &limiter{keys: make(map[string]attempt), perKey: perKey} }
func (l *limiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := nowMS()
	if l.global.until <= now {
		l.global = attempt{until: now + 60000}
	}
	if l.global.count >= 120 {
		return false
	}
	l.global.count++
	if len(l.keys) >= 4096 {
		for k, v := range l.keys {
			if v.until <= now {
				delete(l.keys, k)
			}
		}
		if _, ok := l.keys[key]; !ok && len(l.keys) >= 4096 {
			return false
		}
	}
	entry := l.keys[key]
	if entry.until <= now {
		entry = attempt{until: now + 60000}
	}
	if entry.count >= l.perKey {
		return false
	}
	entry.count++
	l.keys[key] = entry
	return true
}
func (l *limiter) success(key string) { l.mu.Lock(); delete(l.keys, key); l.mu.Unlock() }
