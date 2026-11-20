package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOutputBufferSplitUTF8(t *testing.T) {
	text := "第一行\n第二行🌿"
	output := outputBuffer{limit: len(text)}
	for _, ch := range []byte(text + "ö") {
		if n, err := output.Write([]byte{ch}); n != 1 || err != nil {
			t.Fatalf("write: %d %v", n, err)
		}
	}
	output.finish()
	if got, truncated := output.snapshot(); got != text || !truncated {
		t.Fatalf("got %q (truncated %t), want %q", got, truncated, text)
	}
}

func TestModuleAuthentication(t *testing.T) {
	stopped := false
	handler := moduleHandler(config{moduleID: "python-runner", releaseID: "test", token: "secret"}, http.NotFoundHandler(), func() { stopped = true })
	for _, tt := range []struct {
		token string
		want  int
	}{{"", 401}, {"wrong", 401}, {"secret", 200}} {
		w := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodGet, "/health/ready", nil)
		r.Header.Set("X-ToolNest-Internal-Token", tt.token)
		handler.ServeHTTP(w, r)
		if w.Code != tt.want {
			body, _ := io.ReadAll(w.Result().Body)
			t.Fatalf("status %d, want %d: %s", w.Code, tt.want, body)
		}
	}
	r := httptest.NewRequest(http.MethodPost, "/health/shutdown", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	if w.Code != http.StatusUnauthorized || stopped {
		t.Fatalf("unauthenticated shutdown: status %d, stopped %v", w.Code, stopped)
	}
	r.Header.Set("X-ToolNest-Internal-Token", "secret")
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	if w.Code != http.StatusNoContent || !stopped || w.Body.Len() != 0 {
		t.Fatalf("shutdown: status %d, stopped %v, body %q", w.Code, stopped, w.Body.String())
	}
}
