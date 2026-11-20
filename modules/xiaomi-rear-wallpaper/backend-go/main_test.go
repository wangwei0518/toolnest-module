package main

import (
	"bytes"
	"encoding/json"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

func request(t *testing.T, h http.Handler, method, path, owner, media string, body io.Reader, status int) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(method, path, body)
	r.Header.Set("X-ToolNest-Internal-Token", "test-token")
	r.Header.Set("X-ToolNest-User-Id", owner)
	r.Header.Set("Content-Type", media)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != status {
		t.Fatalf("%s %s: %d %s", method, path, w.Code, w.Body)
	}
	return w
}
func decodeResponse[T any](t *testing.T, w *httptest.ResponseRecorder) T {
	t.Helper()
	var value T
	if err := json.Unmarshal(w.Body.Bytes(), &value); err != nil {
		t.Fatal(err)
	}
	return value
}
func multipartBody(t *testing.T, filename, media string, data, video []byte) (string, *bytes.Buffer) {
	t.Helper()
	body := new(bytes.Buffer)
	writer := multipart.NewWriter(body)
	add := func(field, name, media string, data []byte) {
		header := make(textproto.MIMEHeader)
		header.Set("Content-Disposition", mime.FormatMediaType("form-data", map[string]string{"name": field, "filename": name}))
		header.Set("Content-Type", media)
		part, err := writer.CreatePart(header)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = part.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	if data != nil {
		add("file", filename, media, data)
	}
	if video != nil {
		add("motionVideo", "motion.mp4", "video/mp4", video)
	}
	if err := writer.WriteField("crop", `{"left":0,"top":0,"width":1,"height":1}`); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return writer.FormDataContentType(), body
}

func TestWallpaperHTTP(t *testing.T) {
	s, err := openStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.pending.Wait()
	stopped := false
	h := s.handler("test-token", "xiaomi-rear-wallpaper", "release", func() { stopped = true })
	unauth := httptest.NewRecorder()
	h.ServeHTTP(unauth, httptest.NewRequest("GET", "/health/ready", nil))
	if unauth.Code != 401 {
		t.Fatal("unauthenticated readiness accepted")
	}
	request(t, h, "GET", "/health/ready", "", "", nil, 200)
	var source bytes.Buffer
	if err := png.Encode(&source, image.NewNRGBA(image.Rect(0, 0, 976, 596))); err != nil {
		t.Fatal(err)
	}
	media, body := multipartBody(t, "中文预览.png", "image/png", source.Bytes(), nil)
	result := decodeResponse[uploadResult](t, request(t, h, "POST", "/wallpapers", "user-a", media, body, 200))
	path := "/wallpapers/" + result.Wallpaper.ID
	s.pending.Wait()
	status := decodeResponse[job](t, request(t, h, "GET", "/jobs/"+result.Job.ID, "user-a", "", nil, 200))
	if status.State != "completed" {
		t.Fatalf("%+v", status)
	}
	request(t, h, "GET", path, "user-b", "", nil, 404)
	request(t, h, "GET", "/jobs/"+result.Job.ID, "user-b", "", nil, 404)
	got := request(t, h, "GET", path+"/source", "user-a", "", nil, 200)
	_, parameters, err := mime.ParseMediaType(got.Header().Get("Content-Disposition"))
	if err != nil || parameters["filename"] != "中文预览.png" || !bytes.Equal(source.Bytes(), got.Body.Bytes()) {
		t.Fatal("source or Unicode filename changed")
	}
	for _, suffix := range []string{"/source", "/preview", "/export"} {
		got := request(t, h, "GET", path+suffix, "user-a", "", nil, 200)
		want := strconv.Itoa(got.Body.Len())
		if got.Header().Get("X-ToolNest-Asset-Size") != want || got.Header().Get("Content-Length") != want {
			t.Fatal("progress headers do not match bytes")
		}
	}
	updated := decodeResponse[uploadResult](t, request(t, h, "PUT", path+"/crop", "user-a", "application/json", bytes.NewBufferString(`{"left":0.25,"top":0,"width":0.5,"height":0.5}`), 200))
	s.pending.Wait()
	current := decodeResponse[summary](t, request(t, h, "GET", path, "user-a", "", nil, 200))
	if current.State != "ready" || current.Crop != updated.Wallpaper.Crop {
		t.Fatalf("%+v", current)
	}
	request(t, h, "DELETE", path, "user-a", "", nil, 204)
	request(t, h, "GET", path, "user-a", "", nil, 404)
	request(t, h, "POST", "/health/shutdown", "", "", nil, 204)
	if !stopped {
		t.Fatal("missing shutdown")
	}
}

func TestRecoverLegacyMotion(t *testing.T) {
	root := t.TempDir()
	const owner = "test-user"
	id := "11d3cb45-9a47-4661-aa1d-1bb4dcc64d51"
	videoID := "2cf2f981-f8a6-49cf-82f3-d15d2ff6ad42"
	jobID := "3ef5de7b-5e3c-487d-a7b5-b5f113a350ce"
	dir := filepath.Join(root, "users", owner, id)
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	data := `[{"id":"` + id + `","title":"旧作品","sourceName":"MVIMG.jpg","format":"jpg","width":976,"height":596,"frames":1,"motionPhoto":true,"motionVideoKey":"` + videoID + `","presentationTimestampUs":123456,"crop":{"left":0,"top":0,"width":1,"height":1},"state":"processing","error":null,"jobId":"` + jobID + `","createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}]`
	if err := os.WriteFile(filepath.Join(filepath.Dir(dir), "wallpapers.json"), []byte(data), 0600); err != nil {
		t.Fatal(err)
	}
	video := []byte{0, 0, 0, 16, 'f', 't', 'y', 'p', 'i', 's', 'o', 'm', 0, 0, 0, 0}
	var still, source bytes.Buffer
	if err := jpeg.Encode(&still, image.NewNRGBA(image.Rect(0, 0, 976, 596)), nil); err != nil {
		t.Fatal(err)
	}
	stamp := int64(123456)
	if err := packageMotion(&source, still.Bytes(), video, &stamp); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "source.jpg"), source.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, videoID+".mp4"), video, 0600); err != nil {
		t.Fatal(err)
	}
	s, err := openStore(root)
	if err != nil {
		t.Fatal(err)
	}
	s.pending.Wait()
	h := s.handler("test-token", "wallpaper", "go", func() {})
	path := "/wallpapers/" + id
	assertExport := func() {
		t.Helper()
		export := request(t, h, http.MethodGet, path+"/export", owner, "", nil, 200)
		got, stamp, err := embeddedMotion(export.Body.Bytes())
		if err != nil || stamp == nil || *stamp != 123456 || !bytes.Equal(got, video) {
			t.Fatal("legacy Motion Photo export changed")
		}
	}
	assertExport()
	media, body := multipartBody(t, "", "", nil, video)
	request(t, h, "PUT", path+"/crop", owner, media, body, 200)
	s.pending.Wait()
	assertExport()
	if _, err := os.Stat(filepath.Join(dir, videoID+".mp4")); !os.IsNotExist(err) {
		t.Fatal("replaced MP4 was retained")
	}
}
