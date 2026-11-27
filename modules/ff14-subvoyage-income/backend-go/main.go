package main

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

type server struct {
	store *store
	token string
	stop  context.CancelFunc
	now   func() time.Time
	icons iconService
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}
func fail(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"message": message})
}
func failure(w http.ResponseWriter, err error) {
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, 404, "部队或快照不存在")
		return
	}
	log.Printf("request failed: %v", err)
	fail(w, 500, "潜航控制台暂时无法处理请求")
}
func decode(w http.ResponseWriter, r *http.Request, value any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	decoder := json.NewDecoder(r.Body)
	err := decoder.Decode(value)
	if err == nil && decoder.Decode(new(any)) == io.EOF {
		return true
	}
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		fail(w, 413, "请求体超过 1 MiB")
	} else {
		fail(w, 400, "请求体应为一个有效的 JSON 对象")
	}
	return false
}
func (s *server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health/ready", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, map[string]bool{"ready": true}) })
	mux.HandleFunc("POST /health/shutdown", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204); s.stop() })
	mux.HandleFunc("POST /public/reports", s.receive)
	mux.HandleFunc("GET /companies", s.companies)
	mux.HandleFunc("PATCH /companies/{id}", s.update)
	mux.HandleFunc("GET /webhook", s.webhookStatus)
	mux.HandleFunc("POST /webhook/token", s.issueWebhookToken)
	mux.HandleFunc("PUT /webhook/token", s.issueWebhookToken)
	mux.HandleFunc("GET /dashboard", s.dashboard)
	mux.HandleFunc("GET /trend", s.trend)
	mux.HandleFunc("GET /reports/{date}", s.report)
	mux.HandleFunc("GET /items/{id}/icon", s.icons.serve)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Toolnest-Internal-Token")), []byte(s.token)) != 1 {
			fail(w, 401, "内部认证失败")
			return
		}
		if r.URL.Path != "/health/ready" && r.URL.Path != "/health/shutdown" &&
			!(r.URL.Path == "/public/reports" && r.Method == "POST") && r.Header.Get("X-Toolnest-User-Is-Admin") != "true" {
			fail(w, 403, "需要平台管理员权限")
			return
		}
		mux.ServeHTTP(w, r)
	})
}
func (s *server) receive(w http.ResponseWriter, r *http.Request) {
	token := r.Header.Get("X-ToolNest-Token")
	if len(token) != 43 {
		fail(w, 401, errUnauthorized.Error())
		return
	}
	var report snapshot
	if !decode(w, r, &report) {
		return
	}
	if err := report.normalize(s.now()); err != nil {
		fail(w, 400, err.Error())
		return
	}
	status, err := s.store.saveReport(r.Context(), token, report)
	switch {
	case errors.Is(err, errUnauthorized):
		fail(w, 401, err.Error())
	case errors.Is(err, errConflict):
		fail(w, 409, err.Error())
	case err != nil:
		failure(w, err)
	default:
		writeJSON(w, 200, map[string]string{"status": status})
	}
}
func (s *server) companies(w http.ResponseWriter, r *http.Request) {
	result, err := s.store.listCompanies(r.Context())
	if err != nil {
		failure(w, err)
		return
	}
	writeJSON(w, 200, result)
}

type companyInput struct {
	ID    string `json:"companyId"`
	Alias string `json:"alias"`
}

func validateCompany(w http.ResponseWriter, c *companyInput) bool {
	c.Alias = strings.TrimSpace(c.Alias)
	if !validCompany(c.ID) || !validLabel(c.Alias, 80) {
		fail(w, 400, "请填写有效的部队 ID 和最多 80 字的别名")
		return false
	}
	return true
}
func (s *server) webhookStatus(w http.ResponseWriter, r *http.Request) {
	var configured bool
	if err := s.store.db.QueryRowContext(r.Context(), "SELECT EXISTS(SELECT 1 FROM webhook WHERE id=1)").Scan(&configured); err != nil {
		failure(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"configured": configured})
}

func (s *server) issueWebhookToken(w http.ResponseWriter, r *http.Request) {
	token, hash, err := newToken()
	if err != nil {
		failure(w, err)
		return
	}
	query, status := "INSERT INTO webhook(id,token) VALUES(1,?) ON CONFLICT(id) DO NOTHING", http.StatusCreated
	if r.Method == http.MethodPut {
		query, status = "UPDATE webhook SET token=? WHERE id=1", http.StatusOK
	}
	result, err := s.store.db.ExecContext(r.Context(), query, hash[:])
	if err != nil {
		failure(w, err)
		return
	}
	if affected, err := result.RowsAffected(); err != nil {
		failure(w, err)
		return
	} else if affected == 0 {
		fail(w, http.StatusConflict, "上报令牌状态已变化，请刷新设置")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, status, map[string]string{"token": token})
}
func (s *server) update(w http.ResponseWriter, r *http.Request) {
	var c companyInput
	if !decode(w, r, &c) {
		return
	}
	c.ID = r.PathValue("id")
	if !validateCompany(w, &c) {
		return
	}
	result, err := s.store.db.ExecContext(r.Context(), "UPDATE companies SET alias=? WHERE id=?", c.Alias, c.ID)
	if err != nil {
		failure(w, err)
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		fail(w, 404, "部队不存在")
		return
	}
	writeJSON(w, 200, c)
}
func (s *server) dashboard(w http.ResponseWriter, r *http.Request) {
	id, month := r.URL.Query().Get("companyId"), r.URL.Query().Get("month")
	now := s.now().UTC()
	current := now.In(beijing).Format("2006-01")
	if month == "" {
		month = current
	}
	parsed, err := time.Parse("2006-01", month)
	if !validCompany(id) || err != nil || parsed.Format("2006-01") != month || month > current || parsed.Year() < 2010 {
		fail(w, 400, "部队或统计月份无效")
		return
	}
	result, err := s.store.view(r.Context(), id, month, now)
	if err != nil {
		failure(w, err)
		return
	}
	writeJSON(w, 200, result)
}
func (s *server) trend(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	id, from, to := query.Get("companyId"), query.Get("from"), query.Get("to")
	start, startErr := time.Parse(time.DateOnly, from)
	end, endErr := time.Parse(time.DateOnly, to)
	if !validCompany(id) || startErr != nil || endErr != nil || start.Year() < 2010 ||
		end.Before(start) || end.Sub(start) > 365*24*time.Hour || to > s.now().In(beijing).Format(time.DateOnly) {
		fail(w, 400, "日期范围应为 1 到 366 天，且不能包含未来日期")
		return
	}
	var exists int
	if err := s.store.db.QueryRowContext(r.Context(), "SELECT 1 FROM companies WHERE id=?", id).Scan(&exists); err != nil {
		failure(w, err)
		return
	}
	rows, err := s.store.db.QueryContext(r.Context(), "SELECT day,total FROM daily WHERE company=? AND day BETWEEN ? AND ? ORDER BY day", id, from, to)
	if err != nil {
		failure(w, err)
		return
	}
	defer rows.Close()
	points := []trendPoint{}
	for rows.Next() {
		var point trendPoint
		if err := rows.Scan(&point.Date, &point.Total); err != nil {
			failure(w, err)
			return
		}
		points = append(points, point)
	}
	if err := rows.Err(); err != nil {
		failure(w, err)
		return
	}
	writeJSON(w, 200, points)
}
func (s *server) report(w http.ResponseWriter, r *http.Request) {
	id, date := r.URL.Query().Get("companyId"), r.PathValue("date")
	if _, err := time.Parse(time.DateOnly, date); err != nil || !validCompany(id) {
		fail(w, 400, "部队或日期无效")
		return
	}
	result, err := readJSON[snapshot](s.store.db.QueryRowContext(r.Context(), "SELECT payload FROM daily WHERE company=? AND day=?", id, date))
	if err != nil {
		failure(w, err)
		return
	}
	writeJSON(w, 200, result)
}

const iconHost = "https://xivapi-v2.xivcdn.com"

var iconPath = regexp.MustCompile("^ui/icon/[0-9]{6}/[0-9]{6}(_hr1)?[.]tex$")

type iconService struct {
	client http.Client
	mu     sync.Mutex
	cache  map[string]string
}

func (s *iconService) lookup(r *http.Request, id string) (string, int) {
	s.mu.Lock()
	saved, ok := s.cache[id]
	s.mu.Unlock()
	if ok {
		return saved, 200
	}
	req, err := http.NewRequestWithContext(r.Context(), "GET", iconHost+"/api/sheet/Item/"+id+"?fields=Icon", nil)
	if err != nil {
		return "", 502
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return "", 502
	}
	defer resp.Body.Close()
	if resp.StatusCode == 404 {
		return "", 404
	}
	if resp.StatusCode != 200 {
		return "", 502
	}
	var body struct {
		Fields struct{ Icon struct{ Path string } }
	}
	if err = json.NewDecoder(io.LimitReader(resp.Body, 16384)).Decode(&body); err != nil {
		return "", 502
	}
	path := body.Fields.Icon.Path
	if !iconPath.MatchString(path) {
		return "", 404
	}
	s.mu.Lock()
	if len(s.cache) >= 4096 {
		clear(s.cache)
	}
	s.cache[id] = path
	s.mu.Unlock()
	return path, 200
}
func (s *iconService) serve(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	n, err := strconv.ParseUint(id, 10, 32)
	if err != nil || n == 0 || strconv.FormatUint(n, 10) != id {
		fail(w, 400, "道具 ID 无效")
		return
	}
	path, status := s.lookup(r, id)
	if status != 200 {
		fail(w, status, "道具图标不可用")
		return
	}
	target := iconHost + "/api/asset?" + url.Values{"path": {path}, "format": {"png"}}.Encode()
	req, err := http.NewRequestWithContext(r.Context(), "GET", target, nil)
	if err != nil {
		fail(w, 502, "道具图标不可用")
		return
	}
	resp, err := s.client.Do(req)
	if err != nil {
		fail(w, 502, "道具图标不可用")
		return
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 524289))
	if resp.StatusCode != 200 || err != nil || len(body) > 524288 || !strings.HasPrefix(http.DetectContentType(body), "image/png") {
		fail(w, 502, "道具图标不可用")
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "private, max-age=86400")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(body)
}
func run() error {
	dir, token, port := os.Getenv("TOOLNEST_PLUGIN_DATA_DIR"), os.Getenv("TOOLNEST_PLUGIN_TOKEN"), os.Getenv("TOOLNEST_PLUGIN_PORT")
	p, err := strconv.ParseUint(port, 10, 16)
	if dir == "" || token == "" || err != nil || p == 0 {
		return errors.New("missing or invalid ToolNest runtime environment")
	}
	if err = os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	db, err := openStore(dir)
	if err != nil {
		return err
	}
	defer db.db.Close()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	s := &server{store: db, token: token, stop: stop, now: time.Now, icons: iconService{
		client: http.Client{Timeout: 4 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, cache: make(map[string]string)}}
	listener, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", port))
	if err != nil {
		return err
	}
	httpServer := &http.Server{Handler: s.routes(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 20 * time.Second, IdleTimeout: 30 * time.Second}
	done := make(chan error, 1)
	go func() { done <- httpServer.Serve(listener) }()
	select {
	case err = <-done:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		stopCtx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		err = httpServer.Shutdown(stopCtx)
		if err != nil {
			_ = httpServer.Close()
		}
		<-done
		return err
	}
}
func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}
