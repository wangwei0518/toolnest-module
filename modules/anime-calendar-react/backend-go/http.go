package main

import (
	"bytes"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
)

type httpAPI struct {
	moduleID, releaseID, token string
	service                    *service
	notifications              notifications
	probe                      func(settings) (animeProvider, error)
}

type endpoint func(*http.Request) (any, error)

func (a httpAPI) handler() http.Handler {
	mux := http.NewServeMux()
	add := func(pattern string, fn endpoint) {
		mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
			result, err := fn(r)
			if err == nil {
				writeJSON(w, 200, result)
				return
			}
			var response apiError
			if !errors.As(err, &response) {
				log.Printf("anime calendar %s %s: %v", r.Method, pattern, err)
				response = apiError{500, "新番日历服务暂时不可用"}
			}
			writeError(w, response)
		})
	}
	s := a.service
	add("GET /health/ready", func(*http.Request) (any, error) {
		return map[string]any{"ready": true, "module_id": a.moduleID, "release_id": a.releaseID}, nil
	})
	add("GET /hello", func(*http.Request) (any, error) {
		return map[string]string{"message": "新番日历模块已连接。"}, nil
	})
	add("GET /cour/current", func(*http.Request) (any, error) { return courAt(s.now().In(s.zone)), nil })
	add("GET /items", a.list)
	add("GET /items/{id}", func(r *http.Request) (any, error) { return s.detail(r.Context(), r.PathValue("id")) })
	add("GET /weekly", func(r *http.Request) (any, error) { return s.weekly(r.Context(), boolean(r.URL.Query().Get("force"))) })
	add("GET /today", func(r *http.Request) (any, error) { return s.today(r.Context(), s.zone) })
	add("POST /refresh", a.refresh)
	add("POST /long-running/refresh", func(r *http.Request) (any, error) { return s.refreshLongRunning(r.Context()) })
	add("POST /items/{id}/mark", a.mark)
	add("DELETE /items/{id}/mark", func(r *http.Request) (any, error) { return s.mark(r.Context(), r.PathValue("id"), "") })
	add("GET /stats", func(r *http.Request) (any, error) {
		query := r.URL.Query()
		c, err := a.resolveCour(query.Get("year"), query.Get("cour_month"))
		if err != nil {
			return nil, err
		}
		return s.stats(c), nil
	})
	add("GET /calendar-settings", func(*http.Request) (any, error) { return s.settings() })
	add("PUT /calendar-settings", func(r *http.Request) (any, error) {
		var body json.RawMessage
		if err := readJSON(r, &body); err != nil {
			return nil, err
		}
		return s.saveSettings(r.Context(), body)
	})
	add("POST /connection-test", a.testConnection)
	for pattern, kind := range map[string]string{
		"POST /notifications/test-cour-release": "cour", "POST /notifications/test-watching-update": "watching",
	} {
		add(pattern, func(r *http.Request) (any, error) {
			config, err := a.testSettings(r)
			if err != nil {
				return nil, err
			}
			return a.notifications.test(r.Context(), config, kind)
		})
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if subtle.ConstantTimeCompare([]byte(r.Header.Get(internalTokenHeader)), []byte(a.token)) != 1 || a.token == "" {
			writeError(w, apiError{401, "module authentication required"})
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		mux.ServeHTTP(w, r)
	})
}

func (a httpAPI) list(r *http.Request) (any, error) {
	params := r.URL.Query()
	c, err := a.resolveCour(params.Get("year"), params.Get("cour_month"))
	if err != nil {
		return nil, err
	}
	q := itemQuery{
		Cour: c, Keyword: params.Get("keyword"), Status: params.Get("status"),
		MediaType: params.Get("media_type"), IncludeIgnored: boolean(params.Get("include_ignored")),
	}
	if value := params.Get("weekday"); value != "" {
		weekday, err := integer(value)
		if err != nil {
			return nil, err
		}
		q.Weekday = &weekday
	}
	if mark := params.Get("mark_type"); mark == "watching" || mark == "ignored" {
		q.Mark = mark
	}
	return a.service.list(q), nil
}

func (a httpAPI) refresh(r *http.Request) (any, error) {
	var body struct {
		Year  json.RawMessage `json:"year"`
		Month json.RawMessage `json:"cour_month"`
		Force json.RawMessage `json:"force"`
	}
	if err := readJSON(r, &body); err != nil {
		return nil, err
	}
	c, err := a.resolveCour(jsonText(body.Year), jsonText(body.Month))
	if err != nil {
		return nil, err
	}
	return a.service.refresh(r.Context(), c, boolean(jsonText(body.Force)), false)
}

func (a httpAPI) mark(r *http.Request) (any, error) {
	var body struct {
		Mark string `json:"mark_type"`
	}
	if err := readJSON(r, &body); err != nil {
		return nil, err
	}
	if body.Mark != "watching" && body.Mark != "ignored" {
		return nil, apiError{422, "mark_type 只允许 watching 或 ignored"}
	}
	return a.service.mark(r.Context(), r.PathValue("id"), body.Mark)
}

func (a httpAPI) resolveCour(year, month string) (cour, error) {
	c := courAt(a.service.now().In(a.service.zone))
	for _, field := range []struct {
		value  string
		target *int
	}{{year, &c.Year}, {month, &c.Month}} {
		if field.value != "" {
			value, err := integer(field.value)
			if err != nil {
				return c, err
			}
			*field.target = value
		}
	}
	if !c.valid() {
		// The Node implementation reports invalid quarters through its generic 500 handler.
		return c, errors.New("cour_month 只允许 1、4、7、10")
	}
	return c, nil
}

func (a httpAPI) testSettings(r *http.Request) (settings, error) {
	var body struct {
		Settings json.RawMessage `json:"settings"`
	}
	err := decodeJSON(r, &body)
	if errors.Is(err, io.EOF) || (err == nil && (len(body.Settings) == 0 || bytes.Equal(body.Settings, []byte("null")))) {
		return a.service.settings()
	}
	if err != nil {
		return settings{}, jsonError(err)
	}
	config, err := decodeSettings(body.Settings)
	if err == nil {
		err = config.validate()
	}
	if err != nil {
		return settings{}, apiError{422, err.Error()}
	}
	return config, nil
}

func (a httpAPI) testConnection(r *http.Request) (any, error) {
	config, err := a.testSettings(r)
	if err != nil {
		return nil, err
	}
	provider, err := a.probe(config)
	if err != nil {
		return nil, err
	}
	items, err := provider.fetchWeekly(r.Context())
	if err != nil {
		return nil, err
	}
	return map[string]any{"ok": true, "total": len(items), "message": "连接正常，已读取 " + strconv.Itoa(len(items)) + " 部放送数据"}, nil
}

func readJSON(r *http.Request, target any) error {
	if err := decodeJSON(r, target); err != nil {
		return jsonError(err)
	}
	return nil
}

func decodeJSON(r *http.Request, target any) error {
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var extra json.RawMessage
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err != nil {
			return err
		}
		return errors.New("unexpected trailing JSON document")
	}
	return nil
}

func jsonError(err error) apiError {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		return apiError{413, "请求内容过大"}
	}
	return apiError{400, "请求 JSON 格式不正确"}
}

func integer(raw string) (int, error) {
	number, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil {
		return 0, apiError{400, "查询参数必须是整数"}
	}
	return number, nil
}

func boolean(value string) bool { return value == "1" || value == "true" }

func jsonText(raw json.RawMessage) string {
	var value string
	if json.Unmarshal(raw, &value) == nil {
		return value
	}
	return string(raw)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, err apiError) {
	writeJSON(w, err.status, map[string]any{"code": err.status, "message": err.message, "data": nil})
}
