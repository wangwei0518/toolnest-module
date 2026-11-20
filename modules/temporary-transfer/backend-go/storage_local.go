package main

import (
	"context"
	"crypto/hmac"
	"crypto/md5"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
)

const partSize int64 = 5 << 20
const publicBase = "/api/v1/modules/temporary-transfer/public"

var errNoUpload = errors.New("multipart upload does not exist")
var uploadIDPattern = regexp.MustCompile("^[a-f0-9]{32}$")
var partNamePattern = regexp.MustCompile("^[1-9][0-9]{0,4}\\.part$")

type part struct {
	PartNumber int
	ETag       string
	Size       int64
}

type objectStorage interface {
	start(context.Context, string, string) (string, error)
	putEmpty(context.Context, string, string) error
	signPart(context.Context, string, string, int, int64) (string, error)
	parts(context.Context, string, string) ([]part, error)
	complete(context.Context, string, string, int64) error
	hasCompletedObject(context.Context, string, int64) (bool, error)
	abort(context.Context, string, string) error
	remove(context.Context, string) error
	download(context.Context, string) (string, error)
}

type localClaim struct {
	Op       string `json:"op"`
	Key      string `json:"key"`
	UploadID string `json:"uploadId,omitempty"`
	Part     int    `json:"part,omitempty"`
	Size     int64  `json:"size,omitempty"`
	Expires  int64  `json:"expires"`
}

type localStorage struct {
	root  string
	key   []byte
	locks [64]sync.Mutex
}

func newLocalStorage(dir string) (*localStorage, error) {
	key, err := readOrCreateKey(dir, "local-signing-key")
	if err != nil {
		return nil, err
	}
	return &localStorage{root: filepath.Join(dir, "local-files"), key: key}, nil
}

func (s *localStorage) lock(key string) func() {
	hash := sha256.Sum256([]byte(key))
	lock := &s.locks[int(hash[0])%len(s.locks)]
	lock.Lock()
	return lock.Unlock
}

func (s *localStorage) dir(key string) string {
	hash := sha256.Sum256([]byte(key))
	return filepath.Join(s.root, hex.EncodeToString(hash[:]))
}
func (s *localStorage) objectPath(key string) string { return filepath.Join(s.dir(key), "object") }
func (s *localStorage) uploadDir(key, id string) (string, error) {
	if !uploadIDPattern.MatchString(id) {
		return "", errNoUpload
	}
	return filepath.Join(s.dir(key), "uploads", id), nil
}

func (s *localStorage) sign(claim localClaim) (string, error) {
	raw, err := json.Marshal(claim)
	if err != nil {
		return "", err
	}
	payload := base64.RawURLEncoding.EncodeToString(raw)
	return payload + "." + base64.RawURLEncoding.EncodeToString(mac(s.key, payload)), nil
}

func (s *localStorage) verify(token string) (claim localClaim, ok bool) {
	if len(token) > 2048 {
		return claim, false
	}
	payload, signature, found := strings.Cut(token, ".")
	if !found {
		return claim, false
	}
	actual, err := base64.RawURLEncoding.DecodeString(signature)
	if err != nil || !hmac.Equal(actual, mac(s.key, payload)) {
		return claim, false
	}
	raw, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil || json.Unmarshal(raw, &claim) != nil || claim.Key == "" || claim.Expires <= nowMS() {
		return claim, false
	}
	if claim.Op == "download" {
		return claim, true
	}
	return claim, claim.Op == "upload" && uploadIDPattern.MatchString(claim.UploadID) && claim.Part >= 1 && claim.Part <= 10000 && claim.Size >= 1 && claim.Size <= partSize
}

func (s *localStorage) start(_ context.Context, key, _ string) (string, error) {
	raw, err := randomBytes(16)
	if err != nil {
		return "", err
	}
	id := hex.EncodeToString(raw)
	dir, _ := s.uploadDir(key, id)
	return id, os.MkdirAll(dir, 0700)
}

func (s *localStorage) putEmpty(_ context.Context, key, _ string) error {
	defer s.lock(key)()
	if err := os.MkdirAll(s.dir(key), 0700); err != nil {
		return err
	}
	return os.WriteFile(s.objectPath(key), nil, 0600)
}

func (s *localStorage) signPart(_ context.Context, key, id string, index int, size int64) (string, error) {
	token, err := s.sign(localClaim{Op: "upload", Key: key, UploadID: id, Part: index, Size: size, Expires: nowMS() + 300000})
	if err != nil {
		return "", err
	}
	return publicBase + "/local-upload?token=" + token, nil
}

func (s *localStorage) putPart(ctx context.Context, claim localClaim, body io.Reader, active func() (bool, error)) (string, error) {
	dir, err := s.uploadDir(claim.Key, claim.UploadID)
	if err != nil {
		return "", err
	}
	f, err := os.CreateTemp(dir, "part-*.tmp")
	if err != nil {
		return "", err
	}
	defer os.Remove(f.Name())
	hash := md5.New() // S3-compatible part ETag, not a signature.
	n, copyErr := io.Copy(io.MultiWriter(f, hash), io.LimitReader(body, claim.Size+1))
	err = errors.Join(copyErr, f.Close())
	if err != nil {
		return "", err
	}
	if n != claim.Size {
		return "", clientError(400, "上传分片大小不匹配")
	}
	defer s.lock(claim.Key)()
	if err := ctx.Err(); err != nil {
		return "", err
	}
	ok, err := active()
	if err != nil {
		return "", err
	}
	if !ok {
		return "", clientError(400, "投递已失效")
	}
	if err = os.Rename(f.Name(), filepath.Join(dir, strconv.Itoa(claim.Part)+".part")); err != nil {
		return "", err
	}
	return fmt.Sprintf("%q", hex.EncodeToString(hash.Sum(nil))), nil
}

func (s *localStorage) parts(ctx context.Context, key, id string) ([]part, error) {
	dir, err := s.uploadDir(key, id)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil, errNoUpload
	}
	if err != nil {
		return nil, err
	}
	result := make([]part, 0, len(entries))
	for _, entry := range entries {
		name := entry.Name()
		if !partNamePattern.MatchString(name) {
			continue
		}
		index, _ := strconv.Atoi(strings.TrimSuffix(name, ".part"))
		if index > 10000 {
			continue
		}
		hash := md5.New()
		size, err := copyFileTo(ctx, hash, filepath.Join(dir, name))
		if err != nil {
			return nil, err
		}
		result = append(result, part{PartNumber: index, ETag: fmt.Sprintf("%q", hex.EncodeToString(hash.Sum(nil))), Size: size})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].PartNumber < result[j].PartNumber })
	return result, nil
}

type contextReader struct {
	ctx    context.Context
	source io.Reader
}

func (r contextReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.source.Read(p)
}

func copyFileTo(ctx context.Context, out io.Writer, name string) (int64, error) {
	file, err := os.Open(name)
	if err != nil {
		return 0, err
	}
	defer file.Close()
	return io.Copy(out, contextReader{ctx, file})
}

func countParts(size int64) int { return max(1, int((size+partSize-1)/partSize)) }
func validateParts(parts []part, size int64) error {
	if len(parts) != countParts(size) {
		return clientError(400, "上传分片不完整或大小不匹配")
	}
	for i, p := range parts {
		if p.PartNumber != i+1 || p.Size != min(partSize, size-int64(i)*partSize) {
			return clientError(400, "上传分片不完整或大小不匹配")
		}
	}
	return nil
}

func (s *localStorage) complete(ctx context.Context, key, id string, size int64) error {
	defer s.lock(key)()
	exists, err := s.hasCompletedObject(ctx, key, size)
	if exists || err != nil {
		return err
	}
	parts, err := s.parts(ctx, key, id)
	if err != nil {
		return err
	}
	if err := validateParts(parts, size); err != nil {
		return err
	}
	dir, _ := s.uploadDir(key, id)
	file, err := os.CreateTemp(s.dir(key), "object.*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	var total int64
	for _, p := range parts {
		n, err := copyFileTo(ctx, file, filepath.Join(dir, strconv.Itoa(p.PartNumber)+".part"))
		if err != nil {
			_ = file.Close()
			return err
		}
		total += n
	}
	if total != size {
		_ = file.Close()
		return clientError(400, "上传完成后的文件大小不匹配")
	}
	if err = errors.Join(file.Sync(), file.Close()); err != nil {
		return err
	}
	if err = os.Rename(file.Name(), s.objectPath(key)); err != nil {
		return err
	}
	return os.RemoveAll(dir)
}

func (s *localStorage) hasCompletedObject(_ context.Context, key string, size int64) (bool, error) {
	stat, err := os.Stat(s.objectPath(key))
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return stat.Mode().IsRegular() && stat.Size() == size, nil
}

func (s *localStorage) abort(_ context.Context, key, id string) error {
	defer s.lock(key)()
	dir, err := s.uploadDir(key, id)
	if err != nil {
		return err
	}
	return os.RemoveAll(dir)
}

func (s *localStorage) remove(_ context.Context, key string) error {
	defer s.lock(key)()
	return os.RemoveAll(s.dir(key))
}

func (s *localStorage) download(_ context.Context, key string) (string, error) {
	token, err := s.sign(localClaim{Op: "download", Key: key, Expires: nowMS() + 120000})
	if err != nil {
		return "", err
	}
	return publicBase + "/local-download?token=" + token, nil
}

func disposition(filename string) string {
	name := strings.Map(func(r rune) rune {
		if r < 32 || r == 127 {
			return '_'
		}
		return r
	}, filename)
	if name == "" {
		name = "download"
	}
	return "attachment; filename=\"download\"; filename*=UTF-8''" + strings.ReplaceAll(url.QueryEscape(name), "+", "%20")
}
