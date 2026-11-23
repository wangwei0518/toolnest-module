package main

import (
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func (app *api) attachmentRead(item record) record {
	return record{
		"id": item["id"], "name": item["filename"], "filename": item["filename"],
		"mime_type": item["mime_type"], "size": item["size"],
		"ticket_node_id": item["ticket_node_id"], "field_id": item["field_id"],
		"url": "/api/v1/modules/" + app.moduleID + "/attachments/" + stringValue(item["id"]),
	}
}

func attachmentRootName(item record) string {
	name := stringValue(item["stored_name"])
	if name == "" {
		// Versions before stored_name used the full path. The stored
		// basename also works if the platform data volume was relocated.
		name = filepath.Base(filepath.FromSlash(strings.ReplaceAll(stringValue(item["storage_path"]), "\\", "/")))
	}
	if name == "." || name == ".." || name == "" || strings.ContainsAny(name, "/\\:") || !filepath.IsLocal(name) {
		return ""
	}
	return filepath.Join("attachments", name)
}

func (app *api) queueAttachmentRemoval(state *workflowState, item record) {
	name := attachmentRootName(item)
	if name == "" {
		return
	}
	state.afterCommit = append(state.afterCommit, func() {
		root, err := os.OpenRoot(app.dataDir)
		if err == nil {
			defer root.Close()
			err = root.Remove(name)
		}
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			log.Printf("workflow attachment removal error (%T)", err)
		}
	})
}

func attachmentLimit(state *workflowState, ticketID, nodeID, fieldID string) (record, record, float64, error) {
	ticket, node, _, definition, err := state.executableNode(ticketID, nodeID)
	if err != nil {
		return nil, nil, 0, err
	}
	field := findRecord(asRecords(asRecord(definition["form_schema"])["fields"]), fieldID)
	if field == nil || (field["type"] != "file" && field["type"] != "image") {
		return nil, nil, 0, failure(422, "附件字段不存在")
	}
	limit := numberOrZero(asRecord(field["config"])["max_size_mb"])
	if limit <= 0 {
		limit = numberOrZero(state.settings["max_file_size_mb"])
	}
	if limit <= 0 {
		limit = 20
	}
	return ticket, node, min(limit, 2048), nil
}

func openUpload(request *http.Request) (*multipart.Part, string, error) {
	reader, err := request.MultipartReader()
	if err != nil {
		return nil, "", failure(415, "附件上传格式无效")
	}
	field := ""
	for range 2 {
		part, err := reader.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, "", failure(400, "附件上传格式无效")
		}
		switch part.FormName() {
		case "field_id":
			raw, err := io.ReadAll(io.LimitReader(part, 4097))
			if err != nil || len(raw) > 4096 || part.FileName() != "" {
				return nil, "", failure(422, "附件字段不存在")
			}
			field = strings.TrimSpace(string(raw))
		case "file":
			if field == "" {
				return nil, "", failure(422, "附件字段不存在")
			}
			if part.FileName() != "" {
				return part, field, nil
			}
		default:
			return nil, "", failure(422, "附件上传字段无效")
		}
	}
	return nil, "", failure(422, "上传文件不能为空")
}

func (app *api) saveUpload(request *http.Request) (record, error) {
	file, fieldID, err := openUpload(request)
	if err != nil {
		return nil, err
	}
	ctx := request.Context()
	ticketID, nodeID := request.PathValue("ticketID"), request.PathValue("nodeID")
	var limit float64
	if err := app.repo.read(ctx, func(state *workflowState) error {
		_, _, limit, err = attachmentLimit(state, ticketID, nodeID, fieldID)
		return err
	}); err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(app.dataDir)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	if err := root.Mkdir("attachments", 0750); err != nil && !errors.Is(err, os.ErrExist) {
		return nil, err
	}
	id := newID()
	filename := filepath.Base(strings.ReplaceAll(file.FileName(), "\\", "/"))
	if filename == "." || filename == "/" || filename == "" {
		filename = "attachment"
	}
	extension := filepath.Ext(filename)
	safeExtension := ""
	if len(extension) <= 20 && !strings.ContainsAny(extension, "/\\:*?\"<>|") {
		safeExtension = extension
	}
	stored := id + safeExtension
	destination := filepath.Join("attachments", stored)
	temporary := destination + ".upload"
	out, err := root.OpenFile(temporary, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0640)
	if err != nil {
		return nil, err
	}
	keep := false
	defer func() {
		_ = root.Remove(temporary)
		if !keep {
			_ = root.Remove(destination)
		}
	}()
	maxBytes := int64(limit * 1024 * 1024)
	size, copyErr := io.Copy(out, io.LimitReader(file, maxBytes+1))
	closeErr := out.Close()
	if copyErr != nil {
		return nil, copyErr
	}
	if closeErr != nil {
		return nil, closeErr
	}
	if size > maxBytes {
		return nil, failure(413, fmt.Sprintf("附件不能超过 %g MB", limit))
	}
	if err := root.Rename(temporary, destination); err != nil {
		return nil, err
	}
	item := record{
		"id": id, "ticket_id": ticketID, "field_id": fieldID, "filename": filename,
		"stored_name": stored, "mime_type": stringOr(file.Header.Get("Content-Type"), "application/octet-stream"),
		"extension": extension, "size": size, "storage_path": filepath.Join(app.dataDir, destination),
		"created_at": timestamp(time.Now()),
	}
	if err := app.repo.update(ctx, func(state *workflowState) error {
		_, node, latestLimit, err := attachmentLimit(state, ticketID, nodeID, fieldID)
		if err != nil {
			return err
		}
		if float64(size) > latestLimit*1024*1024 {
			return failure(413, fmt.Sprintf("附件不能超过 %g MB", latestLimit))
		}
		item["ticket_node_id"] = node["id"]
		state.entities["attachments"] = append(state.entities["attachments"], item)
		return nil
	}); err != nil {
		return nil, err
	}
	keep = true
	return app.attachmentRead(item), nil
}

func (app *api) serveAttachment(w http.ResponseWriter, request *http.Request) {
	var item record
	err := app.repo.read(request.Context(), func(state *workflowState) error {
		item = findRecord(state.entities["attachments"], request.PathValue("attachmentID"))
		if item == nil {
			return failure(404, "附件不存在")
		}
		return nil
	})
	if err != nil {
		writeError(w, err)
		return
	}
	name := attachmentRootName(item)
	root, err := os.OpenRoot(app.dataDir)
	if err != nil || name == "" {
		if root != nil {
			_ = root.Close()
		}
		writeError(w, failure(404, "附件不存在"))
		return
	}
	defer root.Close()
	file, err := root.Open(name)
	if err != nil {
		writeError(w, failure(404, "附件不存在"))
		return
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil || !stat.Mode().IsRegular() {
		writeError(w, failure(404, "附件不存在"))
		return
	}
	mimeType, _, _ := mime.ParseMediaType(stringValue(item["mime_type"]))
	disposition := "attachment"
	switch mimeType {
	case "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp":
		disposition = "inline"
	default:
		if mimeType == "" {
			mimeType = "application/octet-stream"
		}
	}
	filename := stringValue(item["filename"])
	w.Header().Set("Content-Disposition", mime.FormatMediaType(disposition, map[string]string{"filename": filename}))
	w.Header().Set("Content-Type", mimeType)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, request, filename, stat.ModTime(), file)
}

func (app *api) registerAttachments(mux *http.ServeMux) {
	mux.HandleFunc("POST /tickets/{ticketID}/nodes/{nodeID}/attachments", func(w http.ResponseWriter, request *http.Request) {
		item, err := app.saveUpload(request)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, 200, record{"data": item})
	})
	mux.HandleFunc("GET /attachments/{attachmentID}", app.serveAttachment)
	app.endpoint(mux, "DELETE /attachments/{attachmentID}", true, func(state *workflowState, request *http.Request, _ record) (any, error) {
		id := request.PathValue("attachmentID")
		file := findRecord(state.entities["attachments"], id)
		if file == nil {
			return nil, failure(404, "附件不存在")
		}
		state.entities["attachments"] = removeMatching(state.entities["attachments"], "id", id)
		app.queueAttachmentRemoval(state, file)
		return nil, nil
	})
}
