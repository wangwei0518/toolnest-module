package main

import (
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const dataImportLimit = 256 << 20

var importedCollections = []string{
	"workflows", "tickets", "timeline", "projects", "milestones", "schedule_items",
	"schedules", "schedule_runs", "saved_views", "automations", "resources", "action_executions",
}

func (app *api) exportData(state *workflowState, now string) record {
	data := record{"schema_version": 3, "settings": state.settings}
	for _, collection := range collections {
		data[collection] = state.entities[collection]
	}
	root, _ := os.OpenRoot(app.dataDir)
	if root != nil {
		defer root.Close()
	}
	files := []record{}
	for _, attachment := range state.entities["attachments"] {
		filename := attachment["filename"]
		item := record{
			"id": attachment["id"], "ticket_id": attachment["ticket_id"], "ticket_node_id": attachment["ticket_node_id"],
			"field_id": attachment["field_id"], "name": filename, "filename": filename, "mime_type": attachment["mime_type"],
			"size": attachment["size"], "content_base64": "",
		}
		if name := attachmentRootName(attachment); root != nil && name != "" {
			if raw, err := readStoredAttachment(root, name); err == nil {
				item["content_base64"] = base64.StdEncoding.EncodeToString(raw)
			}
		}
		files = append(files, item)
	}
	data["attachments"] = files
	return record{"schema_version": 3, "exported_at": now, "data": data}
}

func readStoredAttachment(root *os.Root, name string) ([]byte, error) {
	file, err := root.Open(name)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if !stat.Mode().IsRegular() {
		return nil, errors.New("expected a regular attachment file")
	}
	return io.ReadAll(file)
}

func csvCell(value any) string {
	if value == nil {
		return "\"\""
	}
	return "\"" + strings.ReplaceAll(comparableText(value), "\"", "\"\"") + "\""
}

func ticketCSV(state *workflowState) string {
	var result strings.Builder
	result.WriteString(`"编号","标题","状态","优先级","工作流","项目","里程碑","创建时间"`)
	keys := []string{"number", "title", "status", "priority", "workflow_name", "project_id", "milestone_id", "created_at"}
	for _, ticket := range state.entities["tickets"] {
		result.WriteByte('\n')
		for index, key := range keys {
			if index != 0 {
				result.WriteByte(',')
			}
			result.WriteString(csvCell(ticket[key]))
		}
	}
	return result.String()
}

func importEntities(state *workflowState, incoming record, replace bool) error {
	for _, collection := range importedCollections {
		values, ok := incoming[collection].([]any)
		if !ok {
			continue
		}
		items := state.entities[collection]
		if replace {
			items = []record{}
		}
		known := make(map[string]bool, len(items)+len(values))
		for _, item := range items {
			known[stringValue(item["id"])] = true
		}
		for _, value := range values {
			item := asRecord(value)
			id, ok := item["id"].(string)
			if !ok || id == "" {
				return failure(422, "导入记录缺少有效标识")
			}
			if known[id] {
				if replace {
					return failure(422, "替换导入包含重复标识")
				}
				continue
			}
			known[id] = true
			items = append(items, item)
		}
		state.entities[collection] = items
	}
	return nil
}

func (app *api) importAttachments(state *workflowState, root *os.Root, incoming []record, replace bool, created *[]string) error {
	if len(incoming) == 0 {
		return nil
	}
	if err := root.Mkdir("attachments", 0750); err != nil && !errors.Is(err, os.ErrExist) {
		return err
	}
	if replace {
		for _, item := range state.entities["attachments"] {
			app.queueAttachmentRemoval(state, item)
		}
		state.entities["attachments"] = []record{}
	}
	for _, source := range incoming {
		id := stringValue(source["id"])
		if id == "" || findRecord(state.entities["attachments"], id) != nil {
			id = newID()
		}
		filename := filepath.Base(strings.ReplaceAll(stringOr(source["filename"], stringOr(source["name"], "attachment")), "\\", "/"))
		extension := filepath.Ext(filename)
		stored := newID()
		if len(extension) <= 20 && !strings.ContainsAny(extension, "/\\:*?\"<>|") {
			stored += extension
		}
		name := filepath.Join("attachments", stored)
		file, err := root.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0640)
		if err != nil {
			return err
		}
		*created = append(*created, name)
		content, _ := source["content_base64"].(string)
		size, copyErr := io.Copy(file, base64.NewDecoder(base64.StdEncoding, strings.NewReader(content)))
		closeErr := file.Close()
		if copyErr != nil {
			var corrupt base64.CorruptInputError
			if errors.As(copyErr, &corrupt) || errors.Is(copyErr, io.ErrUnexpectedEOF) {
				return failure(422, "附件内容不是有效 Base64")
			}
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
		state.entities["attachments"] = append(state.entities["attachments"], record{
			"id": id, "ticket_id": stringValue(source["ticket_id"]), "ticket_node_id": stringValue(source["ticket_node_id"]),
			"field_id": stringValue(source["field_id"]), "filename": filename, "stored_name": stored,
			"mime_type": stringOr(source["mime_type"], "application/octet-stream"), "extension": extension,
			"size": size, "storage_path": filepath.Join(app.dataDir, name),
			"created_at": stringOr(source["created_at"], timestamp(time.Now())),
		})
	}
	return nil
}

func (app *api) serveDataImport(w http.ResponseWriter, request *http.Request) {
	body, err := readJSONBody(w, request, dataImportLimit)
	if err != nil {
		writeError(w, err)
		return
	}
	incoming := asRecord(defaultValue(body["data"], body))
	replace := body["mode"] == "replace"
	if replace && body["confirm"] != true {
		writeError(w, failure(422, "替换导入需要 confirm=true"))
		return
	}
	attachments := asRecords(incoming["attachments"])
	var root *os.Root
	if len(attachments) > 0 {
		root, err = os.OpenRoot(app.dataDir)
		if err != nil {
			writeError(w, err)
			return
		}
		defer root.Close()
	}
	var created []string
	counts := map[string]int{}
	err = app.repo.update(request.Context(), func(state *workflowState) error {
		if err := importEntities(state, incoming, replace); err != nil {
			return err
		}
		if err := app.importAttachments(state, root, attachments, replace, &created); err != nil {
			return err
		}
		if settings := asRecord(incoming["settings"]); settings != nil {
			state.settings = newState().settings
			state.mergeSettings(settings)
		}
		for key, values := range state.entities {
			counts[key] = len(values)
		}
		return nil
	})
	if err != nil {
		for _, name := range created {
			_ = root.Remove(name)
		}
		writeError(w, err)
		return
	}
	writeJSON(w, 200, record{"data": record{"imported": true, "schema_version": 3, "counts": counts}})
}

func (app *api) registerData(mux *http.ServeMux) {
	app.endpoint(mux, "GET /data/export", false, func(state *workflowState, _ *http.Request, _ record) (any, error) {
		return app.exportData(state, timestamp(time.Now())), nil
	})
	mux.HandleFunc("GET /data/export.csv", func(w http.ResponseWriter, request *http.Request) {
		var content string
		if err := app.repo.read(request.Context(), func(state *workflowState) error {
			content = ticketCSV(state)
			return nil
		}); err != nil {
			writeError(w, err)
			return
		}
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		_, _ = io.WriteString(w, content)
	})
	mux.HandleFunc("POST /data/import", app.serveDataImport)
}
