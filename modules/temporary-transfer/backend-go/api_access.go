package main

import (
	"encoding/base64"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode"
)

var pinPattern = regexp.MustCompile("^[0-9]{6}$")
var pickupPattern = regexp.MustCompile("^[A-Z0-9]{8}$")

func (a *api) guestPage(w http.ResponseWriter, r *http.Request, _ string) error {
	if !transferIDPattern.MatchString(r.PathValue("id")) {
		return clientError(404, "投递不存在或已失效")
	}
	raw, err := randomBytes(18)
	if err != nil {
		return err
	}
	nonce := base64.RawURLEncoding.EncodeToString(raw)
	origins := ""
	if r2 := a.currentSettings().R2; r2 != nil {
		origins = " https://" + r2.Bucket + "." + r2.AccountID + ".r2.cloudflarestorage.com " + r2.endpoint()
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'nonce-"+nonce+"'; connect-src 'self'"+origins+"; img-src 'self' blob:; media-src blob:; object-src blob:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
	_, _ = w.Write([]byte(strings.ReplaceAll(guestHTML, "{{nonce}}", nonce)))
	return nil
}
func (a *api) guestAsset(w http.ResponseWriter, r *http.Request, _ string) error {
	name := r.PathValue("asset")
	switch name {
	case "guest.js":
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	case "guest.css":
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
	default:
		return clientError(404, "资源不存在")
	}
	f, err := os.Open(filepath.Join("frontend", "dist", name))
	if errors.Is(err, os.ErrNotExist) {
		return clientError(404, "资源不存在")
	}
	if err != nil {
		return err
	}
	defer f.Close()
	stat, err := f.Stat()
	if err != nil {
		return err
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, name, stat.ModTime(), f)
	return nil
}

func (a *api) accessBody(w http.ResponseWriter, r *http.Request, data *accessData, includeID bool) error {
	files, err := a.store.files(r.Context(), data.ID)
	if err != nil {
		return err
	}
	result := map[string]any{"title": data.Title, "content": data.Content, "expiresAt": data.ExpiresAt, "files": files}
	if includeID {
		result["id"] = data.ID
	}
	return privateJSON(w, result)
}
func (a *api) ownedContent(w http.ResponseWriter, r *http.Request, owner string) error {
	release, err := a.lockCrypto()
	if err != nil {
		return err
	}
	defer release()
	data, err := a.store.ownedContent(r.Context(), owner, r.PathValue("id"))
	if err != nil {
		return err
	}
	if data == nil {
		return clientError(404, "投递不存在或已失效")
	}
	return a.accessBody(w, r, data, true)
}
func (a *api) ownerDownload(w http.ResponseWriter, r *http.Request, owner string) error {
	release, err := a.lockCrypto()
	if err != nil {
		return err
	}
	defer release()
	id := r.PathValue("id")
	pin, _, err := a.store.share(r.Context(), owner, id)
	if err != nil {
		return err
	}
	if pin == "" {
		return fileUnavailable()
	}
	return a.authorizeDownload(w, r, id, pin)
}

func (a *api) lookupPickup(w http.ResponseWriter, r *http.Request, owner string, download bool) (*accessData, error) {
	limiter := a.pickupLimiter
	if download {
		limiter = a.pickupDownloadLimiter
	}
	if !limiter.allow(owner) {
		return nil, clientError(429, "尝试过于频繁，请稍后再试")
	}
	input, err := readBody(w, r)
	if err != nil {
		return nil, err
	}
	raw, err := parseText(input["code"], 16)
	if err != nil {
		return nil, clientError(403, "取件码无效或投递已失效")
	}
	code := strings.ToUpper(strings.Map(func(c rune) rune {
		if c == '-' || unicode.IsSpace(c) {
			return -1
		}
		return c
	}, raw))
	if !pickupPattern.MatchString(code) {
		return nil, clientError(403, "取件码无效或投递已失效")
	}
	data, err := a.store.resolvePickup(r.Context(), code)
	if err != nil {
		return nil, err
	}
	if data == nil || (download && data.ID != r.PathValue("id")) {
		return nil, clientError(403, "取件码无效或投递已失效")
	}
	return data, nil
}
func (a *api) pickup(w http.ResponseWriter, r *http.Request, owner string) error {
	release, err := a.lockCrypto()
	if err != nil {
		return err
	}
	defer release()
	data, err := a.lookupPickup(w, r, owner, false)
	if err != nil {
		return err
	}
	return a.accessBody(w, r, data, true)
}
func (a *api) pickupDownload(w http.ResponseWriter, r *http.Request, owner string) error {
	release, err := a.lockCrypto()
	if err != nil {
		return err
	}
	defer release()
	data, err := a.lookupPickup(w, r, owner, true)
	if err != nil {
		return err
	}
	return a.authorizeDownload(w, r, data.ID, data.pin)
}

func (a *api) verifyGuest(w http.ResponseWriter, r *http.Request) (*accessData, error) {
	input, err := readBody(w, r)
	if err != nil {
		return nil, err
	}
	pin, _ := parseText(input["code"], 6)
	id := r.PathValue("id")
	invalid := clientError(403, "提取码无效或投递已失效")
	if !transferIDPattern.MatchString(id) || !pinPattern.MatchString(pin) {
		return nil, invalid
	}
	if !a.guestLimiter.allow(id) {
		return nil, clientError(429, "尝试过于频繁，请稍后再试")
	}
	data, err := a.store.verify(r.Context(), a.store.db, id, pin)
	if err != nil {
		return nil, err
	}
	if data == nil {
		return nil, invalid
	}
	a.guestLimiter.success(id)
	return data, nil
}
func (a *api) guestVerify(w http.ResponseWriter, r *http.Request, _ string) error {
	release, err := a.lockCrypto()
	if err != nil {
		return err
	}
	defer release()
	data, err := a.verifyGuest(w, r)
	if err != nil {
		return err
	}
	return a.accessBody(w, r, data, false)
}
func (a *api) guestDownload(w http.ResponseWriter, r *http.Request, _ string) error {
	release, err := a.lockCrypto()
	if err != nil {
		return err
	}
	defer release()
	data, err := a.verifyGuest(w, r)
	if err != nil {
		return err
	}
	return a.authorizeDownload(w, r, data.ID, data.pin)
}

func fileUnavailable() error {
	return clientError(404, "文件不可用或已达到授权次数限制")
}
func (a *api) authorizeDownload(w http.ResponseWriter, r *http.Request, id, pin string) error {
	ctx := r.Context()
	fileID := r.PathValue("file")
	f, err := grantCandidate(ctx, a.store.db, id, fileID)
	if err != nil {
		return err
	}
	if f == nil {
		return fileUnavailable()
	}
	storage, err := a.storage(f.backend)
	if err != nil {
		return err
	}
	signed, err := storage.download(ctx, f.key)
	if err != nil {
		return err
	}
	claimed, err := a.store.claimGrant(ctx, id, fileID, pin)
	if err != nil {
		return err
	}
	if !claimed {
		return fileUnavailable()
	}
	return privateJSON(w, map[string]string{"url": signed})
}
