package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unicode"
)

type apiError struct {
	status  int
	message string
}

func (e apiError) Error() string   { return e.message }
func invalid(message string) error { return apiError{422, message} }

func sendJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func sendError(w http.ResponseWriter, err error) {
	var known apiError
	switch {
	case errors.As(err, &known):
	case errors.Is(err, errMissing), errors.Is(err, os.ErrNotExist):
		known = apiError{404, "没有找到这张作品或图片文件。"}
	case errors.Is(err, errProcessing):
		known = apiError{409, errProcessing.Error()}
	case errors.Is(err, errImageSize):
		known = apiError{413, errImageSize.Error()}
	default:
		log.Printf("wallpaper request: %v", err)
		known = apiError{500, "模块暂时无法完成请求，请稍后重试。"}
	}
	sendJSON(w, known.status, map[string]any{"code": known.status, "message": known.message, "data": nil})
}

type upload struct {
	source, video []byte
	name          string
	crop          *cropRect
	timestamp     *int64
}

func parseUpload(w http.ResponseWriter, r *http.Request, create bool) (upload, error) {
	var form upload
	media, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if !create && media == "application/json" {
		body := http.MaxBytesReader(w, r.Body, 4096)
		data, err := io.ReadAll(body)
		if err != nil || json.Unmarshal(data, &form.crop) != nil || form.crop == nil {
			return form, invalid("请提供图片裁切范围。")
		}
		return form, nil
	}
	r.Body = http.MaxBytesReader(w, r.Body, 2*maxUpload+(64<<10))
	parts, err := r.MultipartReader()
	if err != nil {
		return form, invalid("请选择要上传的图片或提供裁切范围。")
	}
	seen := map[string]bool{}
	for {
		part, err := parts.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return form, uploadReadError(err)
		}
		name := part.FormName()
		if seen[name] {
			return form, invalid("上传参数重复。")
		}
		seen[name] = true
		switch name {
		case "file":
			if !create {
				return form, invalid("裁切参数无效。")
			}
			switch strings.ToLower(part.Header.Get("Content-Type")) {
			case "image/jpeg", "image/png", "image/webp":
			default:
				return form, apiError{415, "仅支持 JPG、PNG、WebP 或含动态内容的 Live Photo JPG。"}
			}
			form.name = part.FileName()
			form.source, err = readLimited(part, maxUpload)
		case "motionVideo":
			if !strings.EqualFold(part.Header.Get("Content-Type"), "video/mp4") {
				return form, apiError{415, "动态照片视频必须为 MP4 格式。"}
			}
			form.video, err = readLimited(part, maxUpload)
		case "crop":
			var data []byte
			data, err = readLimited(part, 4096)
			if err == nil && json.Unmarshal(data, &form.crop) != nil {
				return form, invalid("裁切范围格式无效。")
			}
		case "presentationTimestampUs":
			var data []byte
			data, err = readLimited(part, 32)
			if err == nil && len(data) > 0 {
				stamp, parseErr := strconv.ParseInt(string(data), 10, 64)
				if parseErr != nil || stamp < -1 || stamp > 9_007_199_254_740_991 {
					return form, invalid("动态照片的关键帧时间无效。")
				}
				form.timestamp = &stamp
			}
		default:
			return form, invalid("上传参数无效。")
		}
		if err != nil {
			return form, uploadReadError(err)
		}
	}
	if create && len(form.source) == 0 {
		return form, apiError{400, "请选择要上传的图片。"}
	}
	if !create && form.crop == nil {
		return form, invalid("请提供图片裁切范围。")
	}
	return form, nil
}

func uploadReadError(err error) error {
	var limit *http.MaxBytesError
	if errors.As(err, &limit) {
		return apiError{413, "上传文件超过大小限制。"}
	}
	return invalid("无法读取上传文件，请重试。")
}
func readLimited(r io.Reader, max int64) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(r, max+1))
	if int64(len(data)) > max {
		return nil, &http.MaxBytesError{Limit: max}
	}
	return data, err
}

type uploadResult struct {
	Wallpaper summary `json:"wallpaper"`
	Job       job     `json:"job"`
}

func trimRunes(value string, n int) string {
	chars := []rune(value)
	return string(chars[:min(n, len(chars))])
}

func (s *store) create(owner string, form upload) (uploadResult, error) {
	var result uploadResult
	info, err := inspectImage(form.source)
	if err != nil {
		if errors.Is(err, errImageSize) {
			return result, err
		}
		return result, invalid("无法读取这张图片，请确认文件没有损坏。")
	}
	if info.format == "gif" || !validFormat(info.format) {
		return result, apiError{415, "仅支持 JPG、PNG 和 WebP 图片。"}
	}
	// Decode before acknowledging upload so a corrupt payload cannot become an editable source.
	if _, err := decodeStill(form.source, info); err != nil {
		return result, invalid("无法读取这张图片，请确认文件没有损坏。")
	}
	motion := form.video != nil
	if motion {
		embedded, stamp, err := embeddedMotion(form.source)
		if info.format != "jpg" || err != nil || len(embedded) == 0 || !validMP4(form.video) {
			return result, invalid("这张 JPG 或配套视频不是有效的安卓 Live Photo。")
		}
		if form.timestamp == nil {
			form.timestamp = stamp
		}
	}
	crop, err := normalizeCrop(form.crop, info.width, info.height)
	if err != nil {
		return result, invalid(err.Error())
	}
	name := trimRunes(filepath.Base(strings.ReplaceAll(form.name, "\\", "/")), 180)
	if name == "." || name == "" {
		name = "wallpaper"
	}
	title := strings.TrimSpace(strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, strings.TrimSuffix(name, filepath.Ext(name))))
	if title == "" {
		title = "未命名壁纸"
	}
	stamp := now()
	jobID := makeUUID()
	r := record{ID: makeUUID(), Title: trimRunes(title, 80), SourceName: name, Format: info.format, Width: info.width, Height: info.height,
		Frames: 1, MotionPhoto: motion, Timestamp: form.timestamp, Crop: crop, State: "processing", JobID: &jobID, CreatedAt: stamp, UpdatedAt: stamp}
	if motion {
		r.MotionVideoKey = makeUUID()
	} else {
		r.Timestamp = nil
	}
	dir := s.recordDir(owner, r)
	s.mu.Lock()
	defer s.mu.Unlock()
	records, err := s.readIndex(owner)
	if err != nil {
		return result, err
	}
	if err = os.MkdirAll(dir, 0700); err != nil {
		return result, err
	}
	committed := false
	defer func() {
		if !committed {
			_ = os.RemoveAll(dir)
		}
	}()
	if err = os.WriteFile(filepath.Join(dir, "source."+r.Format), form.source, 0600); err != nil {
		return result, err
	}
	if motion {
		if err = os.WriteFile(filepath.Join(dir, r.MotionVideoKey+".mp4"), form.video, 0600); err != nil {
			return result, err
		}
	}
	if err = s.writeIndex(owner, append([]record{r}, records...)); err != nil {
		return result, err
	}
	committed = true
	return uploadResult{r.summary(), s.schedule(owner, r)}, nil
}

func (s *store) update(owner, id string, form upload) (uploadResult, error) {
	var result uploadResult
	s.mu.Lock()
	defer s.mu.Unlock()
	records, err := s.readIndex(owner)
	if err != nil {
		return result, err
	}
	i := findRecord(records, id)
	if i < 0 {
		return result, errMissing
	}
	r := records[i]
	if r.State == "processing" {
		return result, errProcessing
	}
	crop, err := normalizeCrop(form.crop, r.Width, r.Height)
	if err != nil {
		return result, invalid(err.Error())
	}
	if r.MotionPhoto != (form.video != nil) || (r.MotionPhoto && !validMP4(form.video)) {
		return result, invalid("请为动态作品提供有效的裁切后 MP4 视频。")
	}
	oldJob, oldVideo := r.JobID, r.MotionVideoKey
	dir := s.recordDir(owner, r)
	if r.MotionPhoto {
		r.MotionVideoKey = makeUUID()
		file := filepath.Join(dir, r.MotionVideoKey+".mp4")
		if err = os.WriteFile(file, form.video, 0600); err != nil {
			_ = os.Remove(file)
			return result, err
		}
		if form.timestamp != nil {
			r.Timestamp = form.timestamp
		}
	}
	id = makeUUID()
	r.Crop, r.State, r.Error, r.JobID, r.UpdatedAt = crop, "processing", nil, &id, now()
	records[i] = r
	if err = s.writeIndex(owner, records); err != nil {
		if r.MotionPhoto {
			_ = os.Remove(filepath.Join(dir, r.MotionVideoKey+".mp4"))
		}
		return result, err
	}
	if idPattern.MatchString(oldVideo) && r.MotionPhoto {
		_ = os.Remove(filepath.Join(dir, oldVideo+".mp4"))
	}
	if oldJob != nil {
		delete(s.jobs, jobKey{owner, *oldJob})
	}
	return uploadResult{r.summary(), s.schedule(owner, r)}, nil
}

func (s *store) remove(owner, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	records, err := s.readIndex(owner)
	if err != nil {
		return err
	}
	i := findRecord(records, id)
	if i < 0 {
		return errMissing
	}
	r := records[i]
	if r.State == "processing" {
		return errProcessing
	}
	if err = s.writeIndex(owner, append(records[:i], records[i+1:]...)); err != nil {
		return err
	}
	if r.JobID != nil {
		delete(s.jobs, jobKey{owner, *r.JobID})
	}
	return os.RemoveAll(s.recordDir(owner, r))
}

func (s *store) handler(token, moduleID, releaseID string, stop func()) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health/ready", func(w http.ResponseWriter, r *http.Request) {
		sendJSON(w, 200, map[string]any{"ready": true, "module_id": moduleID, "release_id": releaseID})
	})
	mux.HandleFunc("POST /health/shutdown", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
		stop()
	})
	protected := func(action func(http.ResponseWriter, *http.Request, string) error) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			owner := r.Header.Get("X-ToolNest-User-Id")
			if !ownerPattern.MatchString(owner) {
				sendError(w, apiError{401, "无法识别当前用户，请重新登录后重试。"})
				return
			}
			if err := action(w, r, owner); err != nil {
				sendError(w, err)
			}
		}
	}
	mux.HandleFunc("GET /wallpapers", protected(func(w http.ResponseWriter, r *http.Request, owner string) error {
		records, err := s.readIndex(owner)
		if err != nil {
			return err
		}
		data := make([]summary, 0, len(records))
		for _, item := range records {
			if idPattern.MatchString(item.ID) && validFormat(item.Format) {
				data = append(data, item.summary())
			}
		}
		sendJSON(w, 200, data)
		return nil
	}))
	mux.HandleFunc("POST /wallpapers", protected(func(w http.ResponseWriter, r *http.Request, owner string) error {
		form, err := parseUpload(w, r, true)
		if err != nil {
			return err
		}
		data, err := s.create(owner, form)
		if err == nil {
			sendJSON(w, 200, data)
		}
		return err
	}))
	mux.HandleFunc("GET /wallpapers/{id}", protected(func(w http.ResponseWriter, r *http.Request, owner string) error {
		data, err := s.get(owner, r.PathValue("id"))
		if err == nil {
			sendJSON(w, 200, data.summary())
		}
		return err
	}))
	mux.HandleFunc("PUT /wallpapers/{id}/crop", protected(func(w http.ResponseWriter, r *http.Request, owner string) error {
		form, err := parseUpload(w, r, false)
		if err != nil {
			return err
		}
		data, err := s.update(owner, r.PathValue("id"), form)
		if err == nil {
			sendJSON(w, 200, data)
		}
		return err
	}))
	mux.HandleFunc("GET /jobs/{id}", protected(func(w http.ResponseWriter, r *http.Request, owner string) error {
		s.mu.Lock()
		data, ok := s.jobs[jobKey{owner, r.PathValue("id")}]
		s.mu.Unlock()
		if !ok {
			return apiError{404, "没有找到这项生成任务。"}
		}
		sendJSON(w, 200, data)
		return nil
	}))
	mux.HandleFunc("GET /wallpapers/{id}/{asset}", protected(s.asset))
	mux.HandleFunc("DELETE /wallpapers/{id}", protected(func(w http.ResponseWriter, r *http.Request, owner string) error {
		if err := s.remove(owner, r.PathValue("id")); err != nil {
			return err
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-ToolNest-Internal-Token")), []byte(token)) != 1 {
			sendError(w, apiError{401, "模块认证失败。"})
			return
		}
		mux.ServeHTTP(w, r)
	})
}

func (s *store) get(owner, id string) (record, error) {
	records, err := s.readIndex(owner)
	if err != nil {
		return record{}, err
	}
	i := findRecord(records, id)
	if i < 0 {
		return record{}, errMissing
	}
	return records[i], nil
}

func (s *store) asset(w http.ResponseWriter, req *http.Request, owner string) error {
	r, err := s.get(owner, req.PathValue("id"))
	if err != nil {
		return err
	}
	asset := req.PathValue("asset")
	var base, extension string
	disposition := "inline"
	switch asset {
	case "source":
		base, extension = "source", r.Format
	case "preview":
		base, extension = "preview", "webp"
	case "export":
		base, extension = "wallpaper", r.outputFormat()
		disposition = "attachment"
	default:
		return errMissing
	}
	if asset != "source" && r.State != "ready" {
		return errProcessing
	}
	file, err := os.Open(filepath.Join(s.recordDir(owner, r), base+"."+extension))
	if err != nil {
		return err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return err
	}
	media := "image/" + extension
	if extension == "jpg" {
		media = "image/jpeg"
	}
	name := strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || strings.ContainsRune("\\/:*?\"<>|", r) {
			return '_'
		}
		return r
	}, r.Title) + "." + extension
	w.Header().Set("Content-Type", media)
	w.Header().Set("Content-Disposition", mime.FormatMediaType(disposition, map[string]string{"filename": name}))
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-ToolNest-Asset-Size", strconv.FormatInt(info.Size(), 10))
	http.ServeContent(w, req, base+"."+extension, time.Time{}, file)
	return nil
}

func run() error {
	moduleID, releaseID := os.Getenv("TOOLNEST_PLUGIN_ID"), os.Getenv("TOOLNEST_PLUGIN_RELEASE_ID")
	root, token := os.Getenv("TOOLNEST_PLUGIN_DATA_DIR"), os.Getenv("TOOLNEST_PLUGIN_TOKEN")
	port, err := strconv.Atoi(os.Getenv("TOOLNEST_PLUGIN_PORT"))
	if moduleID == "" || releaseID == "" || root == "" || token == "" || err != nil || port <= 0 || port > 65535 {
		return errors.New("missing or invalid ToolNest runtime configuration")
	}
	s, err := openStore(root)
	if err != nil {
		return err
	}
	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if parent, err := strconv.Atoi(os.Getenv("TOOLNEST_PLUGIN_PARENT_PID")); err == nil && parent > 1 {
		go watchParent(ctx, parent, stop)
	}
	server := &http.Server{Handler: s.handler(token, moduleID, releaseID, stop), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 35 * time.Second, IdleTimeout: 30 * time.Second}
	serveErr := make(chan error, 1)
	go func() { serveErr <- server.Serve(listener) }()
	select {
	case err = <-serveErr:
		return err
	case <-ctx.Done():
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 18*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdown); err != nil {
		_ = server.Close()
		return err
	}
	done := make(chan struct{})
	go func() { s.pending.Wait(); close(done) }()
	select {
	case <-done:
		return nil
	case <-shutdown.Done():
		return shutdown.Err()
	}
}

func watchParent(ctx context.Context, pid int, stop context.CancelFunc) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for parentAlive(pid) {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
	stop()
}

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}
