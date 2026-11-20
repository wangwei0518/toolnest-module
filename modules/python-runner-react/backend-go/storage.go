package main

import (
	"context"
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type storageStats struct {
	Files int
	Bytes int64
}

func pathsStats(paths ...string) storageStats {
	var total storageStats
	for _, path := range paths {
		_ = filepath.WalkDir(path, func(_ string, item fs.DirEntry, err error) error {
			if err == nil && item.Type().IsRegular() {
				if info, err := item.Info(); err == nil {
					total.Files++
					total.Bytes += info.Size()
				}
			}
			return nil
		})
	}
	return total
}

func confinedPath(base, path string) (string, bool) {
	if !filepath.IsAbs(path) {
		return "", false
	}
	rel, err := filepath.Rel(base, path)
	if err != nil || !filepath.IsLocal(rel) || rel == "." {
		return "", false
	}
	return rel, true
}

func (s *projectService) workspacePaths(ctx context.Context, p project) ([]string, error) {
	rows, err := s.db.Query(ctx, `SELECT workspace_path FROM pr_executions WHERE project_id=$1 AND status NOT IN ('pending','running')
		AND workspace_path IS NOT NULL`, p.ID)
	if err != nil {
		return nil, err
	}
	workspaces, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, err
	}
	for i := range workspaces {
		if _, ok := confinedPath(filepath.Join(s.config.dataDir, "workspaces"), workspaces[i]); !ok {
			workspaces[i] = ""
		}
	}
	ids, err := s.persistentIDs(ctx, p, true)
	if err != nil {
		return nil, err
	}
	for _, id := range ids {
		workspaces = append(workspaces, filepath.Join(s.config.dataDir, "persistent", id))
	}
	return uniquePaths(workspaces), nil
}

func (s *projectService) persistentIDs(ctx context.Context, p project, stopped bool) ([]string, error) {
	rows, err := s.db.Query(ctx, `SELECT id FROM pr_persistent_tasks WHERE (source->>'project_id'=$1 OR source->>'upload_id'=$1)
		AND (NOT $2 OR status<>'running')`, p.ID, stopped)
	if err != nil {
		return nil, err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	return slices.DeleteFunc(ids, func(id string) bool { _, err := taskPath(id); return err != nil }), err
}

func (s *projectService) logPaths(ctx context.Context, p project) ([]string, error) {
	rows, err := s.db.Query(ctx, `SELECT stdout_path,stderr_path FROM pr_executions WHERE project_id=$1`, p.ID)
	if err != nil {
		return nil, err
	}
	result := []string{s.installLogPath(p)}
	for rows.Next() {
		var stdout, stderr *string
		if err := rows.Scan(&stdout, &stderr); err != nil {
			rows.Close()
			return nil, err
		}
		for _, value := range []*string{stdout, stderr} {
			if value != nil {
				if _, ok := confinedPath(filepath.Join(s.config.logDir, "executions"), *value); ok {
					result = append(result, *value)
				}
			}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	ids, err := s.persistentIDs(ctx, p, false)
	if err != nil {
		return nil, err
	}
	for _, id := range ids {
		result = append(result, filepath.Join(s.config.logDir, "persistent", id+".log"))
	}
	return uniquePaths(result), nil
}

func uniquePaths(paths []string) []string {
	paths = slices.DeleteFunc(paths, func(s string) bool { return s == "" })
	slices.Sort(paths)
	return slices.Compact(paths)
}

func (s *projectService) storage(ctx context.Context, p project) (map[string]any, error) {
	dir := s.projectDir(p.ID)
	workspaces, err := s.workspacePaths(ctx, p)
	if err != nil {
		return nil, err
	}
	logs, err := s.logPaths(ctx, p)
	if err != nil {
		return nil, err
	}
	backupDir := filepath.Join(dir, "backups")
	entries, err := os.ReadDir(backupDir)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	var latest *time.Time
	count := 0
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		count++
		if info, err := entry.Info(); err == nil && (latest == nil || info.ModTime().After(*latest)) {
			when := info.ModTime()
			latest = &when
		}
	}
	source := pathsStats(p.Root).Bytes
	venv := pathsStats(filepath.Join(dir, "venv")).Bytes
	data := pathsStats(filepath.Join(dir, "data")).Bytes
	backups := pathsStats(backupDir).Bytes
	workspace := pathsStats(workspaces...).Bytes
	logSize := pathsStats(logs...).Bytes
	return map[string]any{"source_size": source, "venv_size": venv, "data_size": data, "workspace_size": workspace,
		"logs_size": logSize, "backup_size": backups, "backup_count": count, "latest_backup_at": optionalTime(latest),
		"total_size": source + venv + data + workspace + logSize + backups, "workspace_count": len(workspaces), "last_updated_at": formatTime(p.UpdatedAt)}, nil
}

var cleanupMessages = map[string]string{
	"project_data": "已清空项目数据", "venv": "已删除虚拟环境", "backups": "已清理项目备份",
	"install_logs": "已清理安装日志", "workspaces": "已清理执行工作区", "execution_snapshots": "已清理执行快照",
}

func (s *projectService) cleanup(ctx context.Context, p project, target string) (map[string]any, error) {
	base := s.config.dataDir
	dir := s.projectDir(p.ID)
	var paths []string
	switch target {
	case "project_data":
		paths = []string{filepath.Join(dir, "data")}
	case "venv", "backups":
		paths = []string{filepath.Join(dir, target)}
	case "install_logs":
		base = s.config.logDir
		paths = []string{s.installLogPath(p)}
	case "workspaces", "execution_snapshots":
		var err error
		paths, err = s.workspacePaths(ctx, p)
		if err != nil {
			return nil, err
		}
	default:
		return nil, &requestError{status: 422, message: "不支持的清理目标。"}
	}
	before := pathsStats(paths...)
	if target == "venv" {
		if err := s.deleteEnvironment(ctx, p); err != nil {
			return nil, err
		}
	} else {
		root, err := os.OpenRoot(base)
		if err != nil {
			return nil, err
		}
		defer root.Close()
		for _, path := range paths {
			if relative, ok := confinedPath(base, path); ok {
				if err := root.RemoveAll(relative); err != nil {
					return nil, err
				}
			}
		}
	}
	return map[string]any{"target": target, "deleted_files": before.Files, "freed_bytes": before.Bytes, "message": cleanupMessages[target]}, nil
}

func registerStorageRoutes(routes *http.ServeMux, s *projectService, persistent *persistentService) {
	routes.Handle("GET /uploads/{id}/storage", endpoint(func(_ http.ResponseWriter, r *http.Request) (any, error) {
		p, err := s.get(r.Context(), r.PathValue("id"))
		if err != nil {
			return nil, err
		}
		return s.storage(r.Context(), p)
	}))
	routes.Handle("POST /uploads/{id}/maintenance/cleanup", endpoint(func(w http.ResponseWriter, r *http.Request) (any, error) {
		var body struct {
			Target string `json:"target"`
		}
		if err := readJSON(w, r, &body); err != nil {
			return nil, err
		}
		// Lock in the same order as persistent task start.
		persistent.mu.Lock()
		defer persistent.mu.Unlock()
		s.mutations.Lock()
		defer s.mutations.Unlock()
		p, err := s.get(r.Context(), r.PathValue("id"))
		if err != nil {
			return nil, err
		}
		return s.cleanup(r.Context(), p, strings.TrimSpace(body.Target))
	}))
}
