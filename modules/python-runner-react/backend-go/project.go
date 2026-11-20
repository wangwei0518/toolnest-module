package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type projectService struct {
	mutations sync.Mutex
	scans     sync.Mutex
	config    config
	db        *pgxpool.Pool
}

type project struct {
	ID, Name, Status, ReleaseID, SourceHash, Root string
	RequirementsHash                              *string
	CreatedAt, UpdatedAt                          time.Time
	Metadata                                      projectMetadata
}

func (s *projectService) get(ctx context.Context, id string) (project, error) {
	var p project
	err := s.db.QueryRow(ctx, `SELECT p.id,p.name,p.status,r.id,r.source_hash,r.root_path,r.requirements_hash,p.created_at,p.updated_at
		FROM pr_projects p JOIN pr_project_releases r ON r.project_id=p.id AND r.id=p.active_release_id
		WHERE p.id=$1 AND p.status<>'deleted'`, id).Scan(
		&p.ID, &p.Name, &p.Status, &p.ReleaseID, &p.SourceHash, &p.Root, &p.RequirementsHash, &p.CreatedAt, &p.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, notFound("项目不存在。")
	}
	if err != nil {
		return p, err
	}
	if err := s.validateProjectRoot(p); err != nil {
		return p, err
	}
	if err := readProjectMetadata(filepath.Join(filepath.Dir(p.Root), "release.json"), &p.Metadata); err != nil {
		if err := readProjectMetadata(filepath.Join(s.config.dataDir, "projects", p.ID, "project.json"), &p.Metadata); err != nil {
			root, err := os.OpenRoot(p.Root)
			if err != nil {
				return p, err
			}
			defer root.Close()
			p.Metadata, err = analyzeSource(root)
			if err != nil {
				return p, err
			}
		}
	}
	p.Metadata.SourceHash, p.Metadata.RequirementsHash = p.SourceHash, p.RequirementsHash
	return p, nil
}

func (s *projectService) validateProjectRoot(p project) error {
	id, err := projectRelative(p.ID)
	if err != nil || strings.Contains(id, "/") {
		return badRequest("项目编号无效。")
	}
	base := filepath.Join(s.config.dataDir, "projects", p.ID)
	resolved, err := filepath.EvalSymlinks(p.Root)
	if err != nil {
		return notFound("项目源码目录不存在。")
	}
	base, err = filepath.EvalSymlinks(base)
	if err != nil {
		return notFound("项目目录不存在。")
	}
	rel, err := filepath.Rel(base, resolved)
	if err != nil || !filepath.IsLocal(rel) || rel == "." {
		return badRequest("项目源码必须位于项目目录内。")
	}
	return nil
}

func readProjectMetadata(filename string, out *projectMetadata) error {
	data, err := os.ReadFile(filename)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, out)
}

func (s *projectService) prepareExecution(ctx context.Context, input executionInput, workspace string) (preparedExecution, error) {
	s.mutations.Lock()
	defer s.mutations.Unlock()
	id := input.Source.ProjectID
	if id == "" {
		id = input.Source.UploadID
	}
	if id == "" {
		return preparedExecution{}, badRequest("项目执行必须提供 project_id。")
	}
	p, err := s.get(ctx, id)
	if err != nil {
		return preparedExecution{}, err
	}
	scan, err := s.projectScan(ctx, p, false)
	if err != nil {
		return preparedExecution{}, err
	}
	if err := scan.require(input.Security, "运行项目"); err != nil {
		return preparedExecution{}, err
	}
	entry := strings.TrimSpace(input.Source.EntryFile)
	if entry == "" && len(p.Metadata.EntryCandidates) > 0 {
		entry = p.Metadata.EntryCandidates[0]
	}
	if entry == "" && len(p.Metadata.PythonFiles) > 0 {
		entry = p.Metadata.PythonFiles[0]
	}
	if entry == "" {
		return preparedExecution{}, badRequest("项目没有可执行的 Python 入口文件。")
	}
	entry, err = projectRelative(entry)
	if err != nil {
		return preparedExecution{}, err
	}
	root, err := os.OpenRoot(p.Root)
	if err != nil {
		return preparedExecution{}, err
	}
	defer root.Close()
	info, err := root.Stat(entry)
	if err != nil || !info.Mode().IsRegular() {
		return preparedExecution{}, notFound("入口文件不存在：" + entry)
	}
	if err := copyProject(root, workspace); err != nil {
		return preparedExecution{}, err
	}
	file, err := os.Open(filepath.Join(workspace, filepath.FromSlash(entry)))
	if err != nil {
		return preparedExecution{}, err
	}
	defer file.Close()
	code, err := io.ReadAll(io.LimitReader(file, 1<<20))
	if err != nil {
		return preparedExecution{}, err
	}
	python, err := s.resolvePython(ctx, id, input.Runtime)
	if err != nil {
		return preparedExecution{}, err
	}
	return preparedExecution{
		projectID: &p.ID, sourcePath: &p.Root, entry: entry, code: strings.ToValidUTF8(string(code), "�"), interpreter: python,
	}, nil
}

func (s *projectService) resolvePython(ctx context.Context, id, mode string) (string, error) {
	if mode == "system" {
		return s.config.python, nil
	}
	var executable *string
	var status string
	err := s.db.QueryRow(ctx, "SELECT python_executable,status FROM pr_environment_states WHERE project_id=$1", id).Scan(&executable, &status)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	if status == "ready" && executable != nil {
		if info, err := os.Stat(*executable); err == nil && info.Mode().IsRegular() {
			return *executable, nil
		}
	}
	if mode == "project_venv" {
		return "", badRequest("项目虚拟环境未准备好，请先创建环境。")
	}
	return s.config.python, nil
}
