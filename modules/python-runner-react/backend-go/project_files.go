package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"maps"
	"net/http"
	"os"
	"path"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	"gopkg.in/yaml.v3"
)

const projectTextLimit = 1 << 20
const sensitiveMask = "********"

var previewSuffixes = map[string]string{
	".py": "python", ".txt": "text", ".json": "json", ".yaml": "yaml", ".yml": "yaml", ".toml": "toml",
	".md": "markdown", ".ini": "ini", ".cfg": "ini", ".conf": "ini", ".log": "log",
}
var previewNames = map[string]string{
	"requirements.txt": "pip-requirements", "dockerfile": "dockerfile", "makefile": "makefile", ".env.example": "env",
}
var sensitivePreviewNames = []string{".env.development", "id_dsa", "id_ecdsa"}

func (s *projectService) preview(p project, name, scope string) (map[string]any, error) {
	if scope != "" && scope != "source" {
		return nil, &requestError{status: 422, message: "当前仅支持预览项目 source 文件。"}
	}
	relative, err := projectRelative(name)
	if err != nil || strings.TrimSpace(name) != name {
		return nil, &requestError{status: 422, message: "文件路径非法。"}
	}
	root, err := os.OpenRoot(p.Root)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	info, err := root.Lstat(relative)
	if err != nil || !info.Mode().IsRegular() {
		return nil, notFound("文件不存在。")
	}
	base := strings.ToLower(path.Base(relative))
	extension := path.Ext(base)
	if secretFile.MatchString(base) || slices.Contains(sensitivePreviewNames, base) || extension == ".crt" {
		return nil, &requestError{status: 403, message: "敏感文件不允许预览。"}
	}
	language := previewNames[base]
	if language == "" {
		language = previewSuffixes[extension]
	}
	if language == "" {
		return nil, &requestError{status: 415, message: "该文件类型暂不支持预览。"}
	}
	file, err := root.Open(relative)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, projectTextLimit+1))
	if err != nil {
		return nil, err
	}
	if len(data) > projectTextLimit {
		return nil, &requestError{status: 413, message: "文件过大，当前仅支持预览 1 MB 以内的文本文件。"}
	}
	if bytes.IndexByte(data[:min(4096, len(data))], 0) >= 0 {
		return nil, &requestError{status: 415, message: "暂不支持预览二进制文件。"}
	}
	if !utf8.Valid(data) {
		return nil, &requestError{status: 415, message: "暂不支持该文件编码。"}
	}
	return map[string]any{"path": name, "filename": path.Base(relative), "language": language,
		"size": len(data), "encoding": "utf-8", "truncated": false, "readonly": true,
		"content": strings.TrimPrefix(string(data), "\ufeff")}, nil
}

var configFilenames = []string{"config.json", "config.yaml", "config.yml"}
var sensitiveMarkers = []string{"password", "passwd", "secret", "token", "api_key", "apikey", "private_key", "session", "credential"}

func sensitiveKey(key string) bool {
	key = strings.ReplaceAll(strings.ToLower(key), "-", "_")
	for _, marker := range sensitiveMarkers {
		if strings.Contains(key, marker) {
			return true
		}
	}
	return false
}

func blankSensitive(value any) bool {
	switch value := value.(type) {
	case nil:
		return true
	case string:
		return value == "" || value == sensitiveMask
	case []any:
		return len(value) == 0
	case map[string]any:
		return len(value) == 0
	}
	return false
}

func maskedValue(value any) any {
	switch value.(type) {
	case []any:
		return []any{}
	case map[string]any:
		return map[string]any{}
	default:
		return sensitiveMask
	}
}

func maskConfiguration(value any, prefix string, paths, configured *[]string) any {
	switch node := value.(type) {
	case map[string]any:
		out := make(map[string]any, len(node))
		for _, key := range slices.Sorted(maps.Keys(node)) {
			field := key
			if prefix != "" {
				field = prefix + "." + key
			}
			item := node[key]
			if sensitiveKey(key) {
				*paths = append(*paths, field)
				if !blankSensitive(item) {
					*configured = append(*configured, field)
				}
				out[key] = maskedValue(item)
			} else {
				out[key] = maskConfiguration(item, field, paths, configured)
			}
		}
		return out
	case []any:
		out := make([]any, len(node))
		for i, item := range node {
			out[i] = maskConfiguration(item, prefix+"["+strconv.Itoa(i)+"]", paths, configured)
		}
		return out
	default:
		return value
	}
}

func restoreConfiguration(current, submitted any) {
	switch old := current.(type) {
	case map[string]any:
		next, ok := submitted.(map[string]any)
		if !ok {
			return
		}
		for key, value := range old {
			proposed, exists := next[key]
			if !exists {
				continue
			}
			if sensitiveKey(key) {
				if !blankSensitive(value) && blankSensitive(proposed) {
					next[key] = value
				}
			} else {
				restoreConfiguration(value, proposed)
			}
		}
	case []any:
		next, ok := submitted.([]any)
		if !ok {
			return
		}
		for i := range min(len(old), len(next)) {
			restoreConfiguration(old[i], next[i])
		}
	}
}

type configFile struct {
	exists  bool
	values  map[string]any
	updated *string
	problem *string
}

func configurationName(source, overrides *os.Root) string {
	for _, root := range []*os.Root{overrides, source} {
		for _, name := range configFilenames {
			file := name
			if root == overrides {
				file = overrideFilename(name)
			}
			if info, err := root.Lstat(file); err == nil && info.Mode().IsRegular() {
				return name
			}
		}
	}
	return configFilenames[0]
}

func overrideFilename(name string) string { return "config.override" + path.Ext(name) }

func readConfiguration(root *os.Root, file, name string) configFile {
	info, err := root.Lstat(file)
	if err != nil || !info.Mode().IsRegular() {
		return configFile{}
	}
	out := configFile{exists: true, updated: nullString(formatTime(info.ModTime()))}
	f, err := root.Open(file)
	if err != nil {
		out.problem = nullString("无法读取 " + name + "。")
		return out
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, projectTextLimit+1))
	if err != nil {
		out.problem = nullString("无法读取 " + name + "。")
		return out
	}
	if len(data) > projectTextLimit {
		out.problem = nullString(name + " 不能超过 1 MB。")
		return out
	}
	out.values, err = parseConfiguration(data, name)
	if err != nil {
		out.problem = nullString(err.Error())
	}
	return out
}

func parseConfiguration(data []byte, name string) (map[string]any, error) {
	var value any
	var err error
	if path.Ext(name) == ".json" {
		err = json.Unmarshal(data, &value)
	} else {
		err = yaml.Unmarshal(data, &value)
	}
	if err != nil {
		return nil, badRequest(name + " 格式无效。")
	}
	values, ok := value.(map[string]any)
	if !ok {
		return nil, badRequest("配置根节点必须是对象。")
	}
	if err := validateConfigurationKeys(values); err != nil {
		return nil, err
	}
	return values, nil
}

func validateConfigurationKeys(node any) error {
	switch value := node.(type) {
	case map[any]any:
		return badRequest("配置对象的键必须是字符串。")
	case map[string]any:
		for _, item := range value {
			if err := validateConfigurationKeys(item); err != nil {
				return err
			}
		}
	case []any:
		for _, item := range value {
			if err := validateConfigurationKeys(item); err != nil {
				return err
			}
		}
	}
	return nil
}

func serializeConfiguration(values map[string]any, name string) ([]byte, error) {
	if path.Ext(name) != ".json" {
		return yaml.Marshal(values)
	}
	data, err := json.MarshalIndent(values, "", "  ")
	return append(data, '\n'), err
}

func (s *projectService) configuration(p project, input *configurationInput) (map[string]any, error) {
	source, err := os.OpenRoot(p.Root)
	if err != nil {
		return nil, err
	}
	defer source.Close()
	overrides, err := os.OpenRoot(s.projectDir(p.ID))
	if err != nil {
		return nil, err
	}
	defer overrides.Close()
	name := configurationName(source, overrides)
	overrideName := overrideFilename(name)
	base := readConfiguration(source, name, name)
	override := readConfiguration(overrides, overrideName, name)
	if input != nil {
		values := input.Values
		if input.Content != nil {
			if len(*input.Content) > projectTextLimit {
				return nil, badRequest(name + " 不能超过 1 MB。")
			}
			values, err = parseConfiguration([]byte(*input.Content), name)
			if err != nil {
				return nil, err
			}
		}
		if values == nil {
			return nil, badRequest("配置根节点必须是对象。")
		}
		current := override.values
		if current == nil {
			current = base.values
		}
		restoreConfiguration(current, values)
		data, err := serializeConfiguration(values, name)
		if err != nil {
			return nil, badRequest(name + " 格式无效。")
		}
		if len(data) > projectTextLimit {
			return nil, badRequest(name + " 不能超过 1 MB。")
		}
		temp := newID("config-tmp")
		file, err := overrides.OpenFile(temp, os.O_CREATE|os.O_WRONLY|os.O_EXCL, 0600)
		if err != nil {
			return nil, err
		}
		defer overrides.Remove(temp)
		_, err = file.Write(data)
		if err := errors.Join(err, file.Close()); err != nil {
			return nil, err
		}
		if err := overrides.Rename(temp, overrideName); err != nil {
			return nil, err
		}
		override = readConfiguration(overrides, overrideName, name)
	}
	effective := base
	if override.exists {
		effective = override
	}
	paths, configured := []string{}, []string{}
	masked := map[string]any{}
	var content []byte
	if effective.values != nil {
		masked = maskConfiguration(effective.values, "", &paths, &configured).(map[string]any)
		content, err = serializeConfiguration(masked, name)
		if err != nil {
			return nil, err
		}
	}
	return map[string]any{
		"upload_id": p.ID, "file_name": name, "detected": base.exists || override.exists, "source_exists": base.exists,
		"override_exists": override.exists, "valid": effective.problem == nil, "error": effective.problem, "values": masked,
		"sensitive_paths": paths, "configured_sensitive_paths": configured, "source_updated_at": base.updated,
		"updated_at": effective.updated, "size": len(content), "content": string(content),
	}, nil
}

type configurationInput struct {
	Content *string        `json:"content"`
	Values  map[string]any `json:"values"`
}

func registerProjectFileRoutes(routes *http.ServeMux, s *projectService) {
	routes.Handle("GET /uploads/{id}/files/preview", endpoint(func(_ http.ResponseWriter, r *http.Request) (any, error) {
		p, err := s.get(r.Context(), r.PathValue("id"))
		if err != nil {
			return nil, err
		}
		return s.preview(p, r.URL.Query().Get("path"), r.URL.Query().Get("scope"))
	}))
	routes.Handle("GET /uploads/{id}/config", endpoint(func(_ http.ResponseWriter, r *http.Request) (any, error) {
		p, err := s.get(r.Context(), r.PathValue("id"))
		if err != nil {
			return nil, err
		}
		return s.configuration(p, nil)
	}))
	routes.Handle("PUT /uploads/{id}/config", endpoint(func(w http.ResponseWriter, r *http.Request) (any, error) {
		var input configurationInput
		if err := readJSON(w, r, &input); err != nil {
			return nil, err
		}
		s.mutations.Lock()
		defer s.mutations.Unlock()
		p, err := s.get(r.Context(), r.PathValue("id"))
		if err != nil {
			return nil, err
		}
		return s.configuration(p, &input)
	}))
}
