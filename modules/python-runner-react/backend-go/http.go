package main

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"
)

type requestError struct {
	status  int
	message string
	data    any
}

func (e *requestError) Error() string { return e.message }

func badRequest(message string) error {
	return &requestError{status: http.StatusBadRequest, message: message}
}

func notFound(message string) error {
	return &requestError{status: http.StatusNotFound, message: message}
}

func writeError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	message := "模块请求失败。"
	var data any
	var security *securityError
	var request *requestError
	switch {
	case errors.As(err, &security):
		status, message = http.StatusConflict, security.Error()
		data = map[string]any{"security": security.scan}
	case errors.As(err, &request):
		status, message, data = request.status, request.message, request.data
	default:
		log.Printf("Python Runner request failed: %v", err)
	}
	writeJSON(w, status, map[string]any{"code": status, "message": message, "data": data})
}

func readJSON(w http.ResponseWriter, r *http.Request, target any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 8*1024*1024)
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(target); err != nil {
		var oversized *http.MaxBytesError
		if errors.As(err, &oversized) {
			return &requestError{status: http.StatusRequestEntityTooLarge, message: "请求内容超过大小限制。"}
		}
		return badRequest("请求内容不是有效的 JSON。")
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return badRequest("请求内容不是有效的 JSON。")
	}
	return nil
}

type endpoint func(http.ResponseWriter, *http.Request) (any, error)

func (handler endpoint) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	value, err := handler(w, r)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, value)
}

func registerSecurityRoutes(routes *http.ServeMux) {
	routes.Handle("POST /security/scan-inline", endpoint(func(w http.ResponseWriter, r *http.Request) (any, error) {
		var body struct {
			Code string `json:"code"`
		}
		if err := readJSON(w, r, &body); err != nil {
			return nil, err
		}
		if strings.TrimSpace(body.Code) == "" {
			return nil, badRequest("Python 代码不能为空。")
		}
		return scanInline(body.Code), nil
	}))
}
