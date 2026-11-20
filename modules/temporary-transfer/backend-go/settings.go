package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

type r2Config struct {
	AccountID       string `json:"accountId"`
	Bucket          string `json:"bucket"`
	AccessKeyID     string `json:"accessKeyId"`
	SecretAccessKey string `json:"secretAccessKey"`
}

type transferSettings struct {
	DefaultHours         int64     `json:"defaultHours"`
	MaxHours             int64     `json:"maxHours"`
	MaxFileBytes         int64     `json:"maxFileBytes"`
	MaxTotalBytes        int64     `json:"maxTotalBytes"`
	MaxConcurrentUploads int64     `json:"maxConcurrentUploads"`
	DefaultMaxGrants     *int64    `json:"defaultMaxGrants"`
	MaxGrantsAllowed     int64     `json:"maxGrantsAllowed"`
	R2                   *r2Config `json:"r2"`
}

var accountPattern = regexp.MustCompile("^[a-f0-9]{32}$")
var bucketPattern = regexp.MustCompile("^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$")

var defaultSettings = transferSettings{DefaultHours: 24, MaxHours: 168, MaxFileBytes: 512 << 20, MaxTotalBytes: 5 << 30, MaxConcurrentUploads: 2, MaxGrantsAllowed: 10000}

func decodeSettings(base transferSettings, data []byte, fromDisk bool) (transferSettings, error) {
	next := base
	if base.R2 != nil {
		copy := *base.R2
		next.R2 = &copy
	}
	var patch map[string]json.RawMessage
	if err := json.Unmarshal(data, &patch); err != nil || patch == nil {
		return next, clientError(400, "配置格式无效")
	}
	for _, field := range []struct {
		key   string
		value *int64
		max   int64
	}{
		{"defaultHours", &next.DefaultHours, 720}, {"maxHours", &next.MaxHours, 720},
		{"maxFileBytes", &next.MaxFileBytes, 5 << 30}, {"maxTotalBytes", &next.MaxTotalBytes, 1 << 40},
		{"maxConcurrentUploads", &next.MaxConcurrentUploads, 8}, {"maxGrantsAllowed", &next.MaxGrantsAllowed, 10000},
	} {
		raw, ok := patch[field.key]
		if !ok && (!fromDisk || field.key == "maxGrantsAllowed") {
			continue
		}
		n, err := parseInteger(raw, 1, field.max)
		if err != nil {
			return next, clientError(400, field.key+" 超出允许范围")
		}
		*field.value = n
	}
	if next.DefaultHours > next.MaxHours {
		return next, clientError(400, "默认期限不能超过最大期限")
	}
	if next.MaxFileBytes > next.MaxTotalBytes {
		return next, clientError(400, "单文件上限不能超过总容量")
	}
	if raw, ok := patch["defaultMaxGrants"]; ok {
		next.DefaultMaxGrants = nil
		if !isNull(raw) {
			n, err := parseInteger(raw, 1, next.MaxGrantsAllowed)
			if err != nil {
				return next, clientError(400, "defaultMaxGrants 超出允许范围")
			}
			next.DefaultMaxGrants = &n
		}
	}
	if next.DefaultMaxGrants != nil && *next.DefaultMaxGrants > next.MaxGrantsAllowed {
		return next, clientError(400, "defaultMaxGrants 超出允许范围")
	}
	if raw, ok := patch["r2"]; ok {
		if isNull(raw) {
			next.R2 = nil
		} else {
			var fields map[string]json.RawMessage
			if err := json.Unmarshal(raw, &fields); err != nil || fields == nil {
				return next, clientError(400, "R2 配置无效")
			}
			if next.R2 == nil {
				next.R2 = &r2Config{}
			}
			for _, field := range []struct {
				key    string
				target *string
				secret bool
			}{
				{"accountId", &next.R2.AccountID, false}, {"bucket", &next.R2.Bucket, false},
				{"accessKeyId", &next.R2.AccessKeyID, true}, {"secretAccessKey", &next.R2.SecretAccessKey, true},
			} {
				if raw, ok := fields[field.key]; ok && !isNull(raw) {
					var value string
					if json.Unmarshal(raw, &value) != nil {
						return next, clientError(400, "R2 凭证或存储桶配置无效")
					}
					if !field.secret || value != "" {
						*field.target = value
					}
				}
			}
		}
	} else if fromDisk {
		return next, clientError(400, "R2 配置无效")
	}
	if r2 := next.R2; r2 != nil && (!accountPattern.MatchString(r2.AccountID) || !bucketPattern.MatchString(r2.Bucket) ||
		strings.TrimSpace(r2.AccessKeyID) == "" || strings.TrimSpace(r2.SecretAccessKey) == "") {
		return next, clientError(400, "R2 凭证或存储桶配置无效")
	}
	return next, nil
}

func isNull(raw []byte) bool { return bytes.Equal(bytes.TrimSpace(raw), []byte("null")) }

func loadSettings(dir string) (transferSettings, error) {
	data, err := os.ReadFile(filepath.Join(dir, "settings.json"))
	if errors.Is(err, os.ErrNotExist) {
		return defaultSettings, nil
	}
	if err != nil {
		return transferSettings{}, err
	}
	return decodeSettings(defaultSettings, data, true)
}

func saveSettings(dir string, next transferSettings) error {
	data, err := json.Marshal(next)
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(dir, "settings.*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	_, err = f.Write(data)
	if err == nil {
		err = f.Sync()
	}
	if err = errors.Join(err, f.Close()); err != nil {
		return err
	}
	return os.Rename(f.Name(), filepath.Join(dir, "settings.json"))
}

func (s transferSettings) public(adminPresent, admin bool) map[string]any {
	r2 := map[string]any{"configured": s.R2 != nil}
	backend := "local"
	if s.R2 != nil {
		backend = "r2"
		r2["accountId"] = s.R2.AccountID
		r2["bucket"] = s.R2.Bucket
	}
	return map[string]any{
		"defaultHours": s.DefaultHours, "maxHours": s.MaxHours, "maxFileBytes": s.MaxFileBytes, "maxTotalBytes": s.MaxTotalBytes,
		"maxConcurrentUploads": s.MaxConcurrentUploads, "defaultMaxGrants": s.DefaultMaxGrants, "maxGrantsAllowed": s.MaxGrantsAllowed,
		"storageBackend": backend, "r2": r2, "adminContextAvailable": adminPresent, "canManageSettings": admin,
	}
}

func (r r2Config) endpoint() string {
	return fmt.Sprintf("https://%s.r2.cloudflarestorage.com", r.AccountID)
}
