package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/jackc/pgx/v5"
)

type archiveUpload struct {
	filename, temporaryPath, name, source string
	confirmImpact                         bool
}

func readMultipartArchive(w http.ResponseWriter, r *http.Request, dataDir string) (archiveUpload, error) {
	var upload archiveUpload
	r.Body = http.MaxBytesReader(w, r.Body, maxArchiveBytes+(1<<20))
	reader, err := r.MultipartReader()
	if err != nil {
		return upload, badRequest("请上传 ZIP 项目压缩包。")
	}
	success := false
	defer func() {
		if !success && upload.temporaryPath != "" {
			_ = os.Remove(upload.temporaryPath)
		}
	}()
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			return upload, badRequest("项目上传内容无效或超过大小限制。")
		}
		if part.FileName() != "" {
			if upload.temporaryPath != "" {
				return upload, badRequest("每次只能上传一个项目压缩包。")
			}
			f, err := os.CreateTemp(dataDir, "python-upload-*.zip")
			if err != nil {
				return upload, err
			}
			upload.temporaryPath = f.Name()
			size, err := io.Copy(f, io.LimitReader(part, maxArchiveBytes+1))
			closeErr := f.Close()
			if err != nil || size > maxArchiveBytes {
				return upload, badRequest("项目压缩包超过 50 MiB 或上传不完整。")
			}
			if closeErr != nil {
				return upload, closeErr
			}
			if size == 0 {
				return upload, badRequest("项目压缩包不能为空。")
			}
			upload.filename = path.Base(strings.ReplaceAll(part.FileName(), "\\", "/"))
		} else {
			value, err := io.ReadAll(io.LimitReader(part, 4097))
			if err != nil || len(value) > 4096 {
				return upload, badRequest("项目表单字段超出大小限制。")
			}
			switch part.FormName() {
			case "name":
				upload.name = strings.TrimSpace(string(value))
			case "upload_source":
				upload.source = string(value)
			case "confirm_schedule_impact":
				upload.confirmImpact = string(value) == "true"
			}
		}
		part.Close()
	}
	if upload.temporaryPath == "" {
		return upload, badRequest("未收到项目压缩包。")
	}
	success = true
	return upload, nil
}

type projectUpload struct {
	ID              string        `json:"id"`
	Name            string        `json:"name"`
	Filename        string        `json:"filename"`
	UploadSource    string        `json:"upload_source"`
	SourceType      string        `json:"source_type"`
	FileCount       int           `json:"file_count"`
	TotalSize       int64         `json:"total_size"`
	EntryCandidates []string      `json:"entry_candidates"`
	PythonFiles     []string      `json:"python_files"`
	DependencyFiles []string      `json:"dependency_files"`
	FileTree        []projectFile `json:"file_tree"`
	Status          string        `json:"status"`
	ErrorMessage    *string       `json:"error_message"`
	CreatedAt       string        `json:"created_at"`
	UpdatedAt       string        `json:"updated_at"`
}

func (p project) upload() projectUpload {
	m := p.Metadata
	return projectUpload{
		ID: p.ID, Name: p.Name, Filename: m.Filename, UploadSource: m.UploadSource, SourceType: "archive",
		FileCount: m.FileCount, TotalSize: m.TotalSize, EntryCandidates: m.EntryCandidates, PythonFiles: m.PythonFiles,
		DependencyFiles: m.DependencyFiles, FileTree: m.Tree, Status: p.Status, ErrorMessage: m.ErrorMessage,
		CreatedAt: formatTime(p.CreatedAt), UpdatedAt: formatTime(p.UpdatedAt),
	}
}

func (s *projectService) create(ctx context.Context, upload archiveUpload) (projectUpload, error) {
	id, release := newID("project"), newID("release")
	projectDir := filepath.Join(s.config.dataDir, "projects", id)
	releaseDir := filepath.Join(projectDir, "releases", release)
	root := filepath.Join(releaseDir, "source")
	saved := false
	defer func() {
		if !saved {
			_ = os.RemoveAll(projectDir)
		}
	}()
	if err := os.MkdirAll(root, 0700); err != nil {
		return projectUpload{}, err
	}
	m, err := extractArchive(ctx, upload.temporaryPath, root)
	if err != nil {
		return projectUpload{}, err
	}
	m.Filename = upload.filename
	if upload.source == "folder" {
		m.UploadSource = "folder"
	}
	name := upload.name
	if name == "" {
		name = strings.TrimSuffix(m.Filename, path.Ext(m.Filename))
	}
	if name == "" {
		name = "未命名项目"
	}
	chars := []rune(name)
	name = string(chars[:min(len(chars), 120)])
	for _, file := range []string{filepath.Join(releaseDir, "release.json"), filepath.Join(projectDir, "project.json")} {
		if err := writeMetadata(file, m); err != nil {
			return projectUpload{}, err
		}
	}
	if err := os.Rename(upload.temporaryPath, filepath.Join(projectDir, "archive.zip")); err != nil {
		return projectUpload{}, err
	}
	err = pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO pr_projects (id,name,active_release_id,source_hash,requirements_hash)
			VALUES ($1,$2,$3,$4,$5)`, id, name, release, m.SourceHash, m.RequirementsHash); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `INSERT INTO pr_project_releases
			(id,project_id,root_path,source_hash,requirements_hash,entry_candidates,dependency_files,active)
			VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)`, release, id, root, m.SourceHash, m.RequirementsHash, m.EntryCandidates, m.DependencyFiles)
		return err
	})
	if err != nil {
		return projectUpload{}, err
	}
	saved = true
	p, err := s.get(ctx, id)
	return p.upload(), err
}

func writeMetadata(name string, metadata projectMetadata) error {
	data, err := json.MarshalIndent(metadata, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(name, data, 0600)
}

func (s *projectService) list(ctx context.Context, status *string) ([]projectUpload, error) {
	rows, err := s.db.Query(ctx, `SELECT id FROM pr_projects WHERE ($1::text IS NULL OR status = $1)
		ORDER BY updated_at DESC LIMIT 100`, status)
	if err != nil {
		return nil, err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, err
	}
	data := []projectUpload{}
	for _, id := range ids {
		p, err := s.get(ctx, id)
		var request *requestError
		if errors.As(err, &request) && request.status == 404 {
			continue
		}
		if err != nil {
			return nil, err
		}
		data = append(data, p.upload())
	}
	return data, nil
}

func (s *projectService) summaries(ctx context.Context) ([]json.RawMessage, error) {
	rows, err := s.db.Query(ctx, "SELECT to_jsonb(p) FROM pr_projects p ORDER BY updated_at DESC LIMIT 100")
	if err != nil {
		return nil, err
	}
	return pgx.AppendRows([]json.RawMessage{}, rows, pgx.RowTo[json.RawMessage])
}

func (s *projectService) remove(ctx context.Context, id string) error {
	p, err := s.get(ctx, id)
	if err != nil {
		return err
	}
	if _, err := s.db.Exec(ctx, "UPDATE pr_projects SET status='deleted',updated_at=NOW() WHERE id=$1", p.ID); err != nil {
		return err
	}
	root, err := os.OpenRoot(s.config.dataDir)
	if err != nil {
		return err
	}
	defer root.Close()
	return root.RemoveAll("projects/" + p.ID)
}
