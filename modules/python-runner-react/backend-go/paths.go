package main

import (
	"crypto/rand"
	"fmt"
	"io/fs"
	"path/filepath"
	"strings"
)

func newID(prefix string) string {
	var id [16]byte
	_, _ = rand.Read(id[:])
	id[6] = id[6]&0x0f | 0x40
	id[8] = id[8]&0x3f | 0x80
	return fmt.Sprintf("%s_%x-%x-%x-%x-%x", prefix, id[:4], id[4:6], id[6:8], id[8:10], id[10:])
}

func projectRelative(input string) (string, error) {
	return validateProjectRelative(strings.TrimSpace(strings.ReplaceAll(input, "\\", "/")))
}

func validateProjectRelative(value string) (string, error) {
	if !fs.ValidPath(value) || value == "." || strings.ContainsAny(value, ":\x00") || !filepath.IsLocal(filepath.FromSlash(value)) {
		return "", badRequest("路径必须位于项目目录内。")
	}
	return value, nil
}
