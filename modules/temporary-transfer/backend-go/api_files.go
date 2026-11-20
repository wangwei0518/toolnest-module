package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const emptyUpload = "single-empty"

func fileResult(w http.ResponseWriter, status int, f *storedFile) error {
	writeJSON(w, status, map[string]any{"id": f.ID, "partSize": partSize, "partCount": countParts(f.size)})
	return nil
}

func (a *api) addFile(w http.ResponseWriter, r *http.Request, owner string) error {
	ctx := r.Context()
	input, err := readBody(w, r)
	if err != nil {
		return err
	}
	name, err := parseText(input["filename"], 180)
	if err != nil {
		return err
	}
	name = strings.TrimSpace(name)
	if name == "" || strings.ContainsFunc(name, func(r rune) bool { return r < 32 || r == 127 }) {
		return clientError(400, "输入文件名无效")
	}
	fileID, err := parseText(input["clientId"], 36)
	if err != nil {
		return err
	}
	if !clientIDPattern.MatchString(fileID) {
		return clientError(400, "输入内容无效")
	}
	lock := a.fileLock(fileID)
	if !lock.TryLock() {
		return clientError(409, "上传初始化中，请稍后重试")
	}
	defer lock.Unlock()
	// Freeze the bucket while reserving a file so settings cannot switch its storage underneath it.
	a.settingsMu.RLock()
	settings := a.settings
	size, err := parseInteger(input["size"], 0, settings.MaxFileBytes)
	if err != nil {
		a.settingsMu.RUnlock()
		return err
	}
	backend := "local"
	if settings.R2 != nil {
		backend = "r2"
	}
	file, existing, err := a.store.addFile(ctx, owner, r.PathValue("id"), fileID, name, size, settings.MaxTotalBytes, backend)
	a.settingsMu.RUnlock()
	if err != nil {
		return err
	}
	if existing && (file.state != "pending" || file.uploadID.Valid) {
		return fileResult(w, 200, file)
	}
	storage, err := a.storage(file.backend)
	if err != nil {
		return err
	}
	uploadID := emptyUpload
	if size > 0 {
		uploadID, err = storage.start(ctx, file.key, file.filename)
	}
	if err == nil {
		err = a.setPending(ctx, file, &uploadID)
	}
	if err == nil && size == 0 {
		if err = storage.putEmpty(ctx, file.key, file.filename); err == nil {
			err = a.setPending(ctx, file, nil)
		}
	}
	if err != nil {
		cleanCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		defer cancel()
		cleaned := a.cleanupUpload(cleanCtx, storage, file, uploadID)
		if cleaned {
			if forgetErr := a.store.forgetFile(cleanCtx, file.ID, true); forgetErr != nil {
				log.Printf("清除失败上传的记录 (%T)", forgetErr)
			}
		}
		return err
	}
	return fileResult(w, 201, file)
}

func (a *api) setPending(ctx context.Context, f *storedFile, uploadID *string) error {
	ok, err := a.store.changePending(ctx, f.ID, uploadID)
	if err != nil {
		return err
	}
	if !ok {
		return clientError(400, "投递已失效")
	}
	return nil
}

func (a *api) cleanupUpload(ctx context.Context, storage objectStorage, f *storedFile, uploadID string) bool {
	var err error
	switch uploadID {
	case "":
		return true
	case emptyUpload:
		err = storage.remove(ctx, f.key)
	default:
		err = storage.abort(ctx, f.key, uploadID)
	}
	if err == nil || errors.Is(err, errNoUpload) {
		return true
	}
	if rememberErr := a.store.rememberUploadForCleanup(ctx, f.ID, uploadID); rememberErr != nil {
		log.Printf("保存待清理上传会话失败 (%T)", rememberErr)
	}
	return false
}

func (a *api) resolveOwnedFile(r *http.Request, owner string) (*storedFile, error) {
	f, err := a.store.ownedFile(r.Context(), owner, r.PathValue("id"), r.PathValue("file"))
	if err != nil {
		return nil, err
	}
	if f == nil {
		return nil, clientError(400, "投递文件不存在或已失效")
	}
	return f, nil
}

func partsResult(w http.ResponseWriter, parts []part, done bool) error {
	if parts == nil {
		parts = []part{}
	}
	writeJSON(w, 200, map[string]any{"parts": parts, "completed": done})
	return nil
}

func (a *api) listParts(w http.ResponseWriter, r *http.Request, owner string) error {
	ctx := r.Context()
	lock := a.fileLock(r.PathValue("file"))
	if !lock.TryLock() {
		return clientError(409, "上传初始化中，请稍后重试")
	}
	defer lock.Unlock()
	file, err := a.resolveOwnedFile(r, owner)
	if err != nil {
		return err
	}
	if file.state == "ready" {
		return partsResult(w, nil, true)
	}
	if !file.uploadID.Valid {
		return clientError(400, "投递文件不存在或已失效")
	}
	storage, err := a.storage(file.backend)
	if err != nil {
		return err
	}
	if file.uploadID.String != emptyUpload {
		parts, err := storage.parts(ctx, file.key, file.uploadID.String)
		if err == nil {
			return partsResult(w, parts, false)
		}
		if !errors.Is(err, errNoUpload) {
			return err
		}
	}
	exists, err := storage.hasCompletedObject(ctx, file.key, file.size)
	if err != nil {
		return err
	}
	if exists {
		if err := a.setPending(ctx, file, nil); err != nil {
			return err
		}
		return partsResult(w, nil, true)
	}
	if file.uploadID.String == emptyUpload {
		// A restart can leave reserved zero-byte metadata before the object is written.
		if err := storage.putEmpty(ctx, file.key, file.filename); err != nil {
			return err
		}
		if err := a.setPending(ctx, file, nil); err != nil {
			return err
		}
		return partsResult(w, nil, true)
	}
	replacement, err := storage.start(ctx, file.key, file.filename)
	if err != nil {
		return err
	}
	if err = a.setPending(ctx, file, &replacement); err != nil {
		cleanCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		defer cancel()
		a.cleanupUpload(cleanCtx, storage, file, replacement)
		return err
	}
	return partsResult(w, nil, false)
}

func (a *api) signPart(w http.ResponseWriter, r *http.Request, owner string) error {
	file, err := a.resolveOwnedFile(r, owner)
	if err != nil {
		return err
	}
	if !file.uploadID.Valid || file.uploadID.String == emptyUpload || file.state != "pending" {
		return clientError(400, "投递文件不存在或已失效")
	}
	index, err := strconv.Atoi(r.PathValue("part"))
	if err != nil || index < 1 || index > countParts(file.size) {
		return clientError(400, "输入数值超出允许范围")
	}
	storage, err := a.storage(file.backend)
	if err != nil {
		return err
	}
	signed, err := storage.signPart(r.Context(), file.key, file.uploadID.String, index, min(partSize, file.size-int64(index-1)*partSize))
	if err != nil {
		return err
	}
	return privateJSON(w, map[string]string{"url": signed})
}

func (a *api) completeFile(w http.ResponseWriter, r *http.Request, owner string) error {
	ctx := r.Context()
	lock := a.fileLock(r.PathValue("file"))
	if !lock.TryLock() {
		return clientError(409, "上传初始化中，请稍后重试")
	}
	defer lock.Unlock()
	file, err := a.resolveOwnedFile(r, owner)
	if err != nil {
		return err
	}
	if file.state == "ready" {
		return okJSON(w)
	}
	if !file.uploadID.Valid || file.state != "pending" {
		return clientError(400, "投递文件不存在或已失效")
	}
	storage, err := a.storage(file.backend)
	if err != nil {
		return err
	}
	if file.uploadID.String != emptyUpload {
		err = storage.complete(ctx, file.key, file.uploadID.String, file.size)
		if err != nil && !errors.Is(err, errNoUpload) {
			return err
		}
	}
	exists, err := storage.hasCompletedObject(ctx, file.key, file.size)
	if err != nil {
		return err
	}
	if !exists {
		return clientError(400, "投递文件不存在或已失效")
	}
	if err := a.setPending(ctx, file, nil); err != nil {
		return err
	}
	return okJSON(w)
}

func (a *api) localUpload(w http.ResponseWriter, r *http.Request, _ string) error {
	ctx := r.Context()
	claim, ok := a.local.verify(r.URL.Query().Get("token"))
	if !ok || claim.Op != "upload" {
		return clientError(403, "上传授权无效或投递已失效")
	}
	active := func() (bool, error) { return a.store.localUploadActive(ctx, claim.Key, claim.UploadID) }
	ok, err := active()
	if err != nil {
		return err
	}
	if !ok {
		return clientError(403, "上传授权无效或投递已失效")
	}
	if r.ContentLength >= 0 && r.ContentLength != claim.Size {
		return clientError(400, "上传分片大小不匹配")
	}
	media, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if media != "application/octet-stream" {
		return clientError(400, "上传分片格式无效")
	}
	select {
	case a.localUploadSlots <- struct{}{}:
		defer func() { <-a.localUploadSlots }()
	default:
		return clientError(429, "上传请求过多，请稍后重试")
	}
	etag, err := a.local.putPart(ctx, claim, r.Body, active)
	if err != nil {
		return err
	}
	w.Header().Set("ETag", etag)
	w.WriteHeader(204)
	return nil
}

var singleRange = regexp.MustCompile("^bytes=([0-9]*)-([0-9]*)$")

func (a *api) localDownload(w http.ResponseWriter, r *http.Request, _ string) error {
	claim, ok := a.local.verify(r.URL.Query().Get("token"))
	if !ok || claim.Op != "download" {
		return clientError(403, "下载授权无效或已过期")
	}
	file, err := a.store.localDownload(r.Context(), claim.Key)
	if err != nil {
		return err
	}
	if file == nil {
		return clientError(404, "文件不存在或投递已失效")
	}
	reader, err := os.Open(a.local.objectPath(claim.Key))
	if errors.Is(err, os.ErrNotExist) {
		return clientError(404, "文件不存在或投递已失效")
	}
	if err != nil {
		return err
	}
	defer reader.Close()
	stat, err := reader.Stat()
	if err != nil {
		return err
	}
	if !stat.Mode().IsRegular() || stat.Size() != file.size {
		return clientError(404, "文件不存在或投递已失效")
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", disposition(file.filename))
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Accept-Ranges", "bytes")
	if raw := r.Header.Get("Range"); raw != "" {
		match := singleRange.FindStringSubmatch(raw)
		if match == nil || (match[1] == "" && match[2] == "") || file.size == 0 {
			w.Header().Set("Content-Range", fmt.Sprintf("bytes */%d", file.size))
			w.WriteHeader(416)
			return nil
		}
	}
	http.ServeContent(w, r, filepath.Base(file.filename), time.Time{}, reader)
	return nil
}

func (a *api) cleanup(ctx context.Context) error {
	if err := a.store.purgeExpiredText(ctx); err != nil {
		return err
	}
	files, err := a.store.cleanupCandidates(ctx)
	if err != nil {
		return err
	}
	for _, file := range files {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := a.cleanupFile(ctx, file); err != nil {
			return err
		}
	}
	return nil
}

func (a *api) cleanupFile(ctx context.Context, file storedFile) error {
	lock := a.fileLock(file.ID)
	if !lock.TryLock() {
		return nil
	}
	defer lock.Unlock()
	storage, err := a.storage(file.backend)
	if err == nil && file.uploadID.Valid && file.uploadID.String != emptyUpload {
		err = storage.abort(ctx, file.key, file.uploadID.String)
		if errors.Is(err, errNoUpload) {
			err = nil
		}
	}
	if err == nil {
		err = storage.remove(ctx, file.key)
	}
	if err == nil {
		return a.store.forgetFile(ctx, file.ID, false)
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	log.Printf("文件邮局文件清理失败 (%T)，稍后重试", err)
	_, err = a.store.db.ExecContext(ctx, "UPDATE files SET cleanup_attempts=cleanup_attempts+1,cleanup_last_at=? WHERE id=?", nowMS(), file.ID)
	return err
}
