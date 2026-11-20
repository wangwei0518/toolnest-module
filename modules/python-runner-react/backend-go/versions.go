package main

import (
	"archive/zip"
	"context"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"
)

type impactedTask struct {
	ID     string  `json:"id"`
	Name   string  `json:"name"`
	Type   string  `json:"type"`
	Status string  `json:"status"`
	Entry  *string `json:"entry_file"`
}

type projectImpact struct {
	Tasks   []impactedTask `json:"impacted_tasks"`
	Missing []impactedTask `json:"missing_entry_tasks"`
}

func (s *projectService) impact(ctx context.Context, id string, entries []string, confirmed bool) (projectImpact, error) {
	value := projectImpact{Tasks: []impactedTask{}, Missing: []impactedTask{}}
	rows, err := s.db.Query(ctx, `
		SELECT id,name,'schedule',status,source->>'entry_file' FROM pr_scheduled_tasks
		WHERE source->>'project_id'=$1 OR source->>'upload_id'=$1
		UNION ALL
		SELECT id,name,'persistent',status,source->>'entry_file' FROM pr_persistent_tasks
		WHERE source->>'project_id'=$1 OR source->>'upload_id'=$1`, id)
	if err != nil {
		return value, err
	}
	value.Tasks, err = pgx.AppendRows(value.Tasks, rows, func(row pgx.CollectableRow) (impactedTask, error) {
		var task impactedTask
		err := row.Scan(&task.ID, &task.Name, &task.Type, &task.Status, &task.Entry)
		return task, err
	})
	if err != nil {
		return value, err
	}
	for _, task := range value.Tasks {
		if task.Entry != nil && !slices.Contains(entries, *task.Entry) {
			value.Missing = append(value.Missing, task)
		}
	}
	if len(value.Tasks) > 0 && !confirmed {
		return value, &requestError{status: 409, message: "项目更新会影响已有任务，请确认后继续。", data: map[string]any{"impact": value}}
	}
	return value, nil
}

func (s *projectService) update(ctx context.Context, id string, upload archiveUpload) (map[string]any, error) {
	s.mutations.Lock()
	defer s.mutations.Unlock()
	current, err := s.get(ctx, id)
	if err != nil {
		return nil, err
	}
	next := current
	next.ReleaseID = newID("release")
	releaseDirectory := filepath.Join(s.projectDir(id), "releases", next.ReleaseID)
	next.Root = filepath.Join(releaseDirectory, "source")
	committed := false
	defer func() {
		if !committed {
			_ = os.RemoveAll(releaseDirectory)
		}
	}()
	if err := os.MkdirAll(next.Root, 0700); err != nil {
		return nil, err
	}
	next.Metadata, err = extractArchive(ctx, upload.temporaryPath, next.Root)
	if err != nil {
		return nil, err
	}
	impact, err := s.impact(ctx, id, next.Metadata.EntryCandidates, upload.confirmImpact)
	if err != nil {
		return nil, err
	}
	next.SourceHash, next.RequirementsHash = next.Metadata.SourceHash, next.Metadata.RequirementsHash
	next.Metadata.Filename = upload.filename
	if upload.source == "folder" {
		next.Metadata.UploadSource = "folder"
	}
	next.Metadata.UpdateCount = current.Metadata.UpdateCount + 1
	if name := []rune(strings.TrimSpace(upload.name)); len(name) > 0 {
		next.Name = string(name[:min(len(name), 120)])
	}
	backupID := newID("backup")
	next.Metadata.LastBackupID = &backupID
	backupDir := filepath.Join(s.projectDir(id), "backups", backupID)
	defer func() {
		if !committed {
			_ = os.RemoveAll(backupDir)
		}
	}()
	backup := filepath.Join(backupDir, "source")
	if err := os.MkdirAll(backup, 0700); err != nil {
		return nil, err
	}
	source, err := os.OpenRoot(current.Root)
	if err != nil {
		return nil, err
	}
	err = copyProject(source, backup)
	source.Close()
	if err != nil {
		return nil, err
	}
	if err := writeMetadata(filepath.Join(releaseDirectory, "release.json"), next.Metadata); err != nil {
		return nil, err
	}
	err = s.activate(ctx, current, next, true)
	if err != nil {
		return nil, err
	}
	committed = true
	if err := s.syncLegacyProjectFiles(next, upload.temporaryPath); err != nil {
		return nil, err
	}
	if err := s.pruneReleases(ctx, next); err != nil {
		return nil, err
	}
	message := "项目已更新。"
	if differentHash(current.RequirementsHash, next.RequirementsHash) {
		message = "项目已更新，检测到依赖变化，请重新安装运行环境。"
	}
	return versionResult(current, next, impact, "updated", backupID, message), nil
}

func (s *projectService) rollback(ctx context.Context, id string, confirmed bool) (map[string]any, error) {
	s.mutations.Lock()
	defer s.mutations.Unlock()
	current, err := s.get(ctx, id)
	if err != nil {
		return nil, err
	}
	previous := current
	err = s.db.QueryRow(ctx, `SELECT id,root_path,source_hash,requirements_hash FROM pr_project_releases
		WHERE project_id=$1 AND id<>$2 ORDER BY created_at DESC LIMIT 1`, id, current.ReleaseID).
		Scan(&previous.ReleaseID, &previous.Root, &previous.SourceHash, &previous.RequirementsHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, badRequest("暂无可回滚版本。")
	}
	if err != nil {
		return nil, err
	}
	if err := s.validateProjectRoot(previous); err != nil {
		return nil, badRequest("上一版本文件已不可用，无法回滚。")
	}
	if err := readProjectMetadata(filepath.Join(filepath.Dir(previous.Root), "release.json"), &previous.Metadata); err != nil {
		root, err := os.OpenRoot(previous.Root)
		if err != nil {
			return nil, err
		}
		defer root.Close()
		previous.Metadata, err = analyzeSource(root)
		if err != nil {
			return nil, err
		}
	}
	previous.Metadata.SourceHash, previous.Metadata.RequirementsHash = previous.SourceHash, previous.RequirementsHash
	previous.Metadata.LastBackupID = &current.ReleaseID
	impact, err := s.impact(ctx, id, previous.Metadata.EntryCandidates, confirmed)
	if err != nil {
		return nil, err
	}
	temp, err := os.CreateTemp(s.projectDir(id), "rollback-*.zip")
	if err != nil {
		return nil, err
	}
	defer os.Remove(temp.Name())
	if err := errors.Join(writeProjectZip(temp, previous.Root), temp.Close()); err != nil {
		return nil, err
	}
	if err := s.activate(ctx, current, previous, false); err != nil {
		return nil, err
	}
	if err := s.syncLegacyProjectFiles(previous, temp.Name()); err != nil {
		return nil, err
	}
	return versionResult(current, previous, impact, "rolled_back", previous.ReleaseID, "项目已回滚。"), nil
}

func (s *projectService) activate(ctx context.Context, current, next project, create bool) error {
	return pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE pr_projects SET name=$1,active_release_id=$2,source_hash=$3,
			requirements_hash=$4,updated_at=NOW() WHERE id=$5 AND active_release_id=$6 AND status<>'deleted'`,
			next.Name, next.ReleaseID, next.SourceHash, next.RequirementsHash, current.ID, current.ReleaseID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 1 {
			return &requestError{status: 409, message: "项目已更新，请刷新后重试。"}
		}
		if _, err := tx.Exec(ctx, "UPDATE pr_project_releases SET active=FALSE WHERE project_id=$1", current.ID); err != nil {
			return err
		}
		if create {
			_, err = tx.Exec(ctx, `INSERT INTO pr_project_releases
				(id,project_id,root_path,source_hash,requirements_hash,entry_candidates,dependency_files,active)
				VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)`, next.ReleaseID, current.ID, next.Root, next.SourceHash, next.RequirementsHash,
				next.Metadata.EntryCandidates, next.Metadata.DependencyFiles)
		} else {
			_, err = tx.Exec(ctx, "UPDATE pr_project_releases SET active=TRUE WHERE id=$1 AND project_id=$2", next.ReleaseID, current.ID)
		}
		return err
	})
}

func (s *projectService) syncLegacyProjectFiles(p project, archive string) error {
	dir := s.projectDir(p.ID)
	m, err := os.CreateTemp(dir, "metadata-*.json")
	if err != nil {
		return err
	}
	defer os.Remove(m.Name())
	if err := m.Close(); err != nil {
		return err
	}
	if err := writeMetadata(m.Name(), p.Metadata); err != nil {
		return err
	}
	if err := os.Rename(m.Name(), filepath.Join(dir, "project.json")); err != nil {
		return err
	}
	return os.Rename(archive, filepath.Join(dir, "archive.zip"))
}

func (s *projectService) pruneReleases(ctx context.Context, p project) error {
	rows, err := s.db.Query(ctx, `SELECT id FROM pr_project_releases WHERE project_id=$1
		ORDER BY active DESC,created_at DESC OFFSET 3`, p.ID)
	if err != nil {
		return err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return err
	}
	root, err := os.OpenRoot(s.projectDir(p.ID))
	if err != nil {
		return err
	}
	defer root.Close()
	for _, id := range ids {
		relative, err := projectRelative(id)
		if err != nil || strings.Contains(relative, "/") {
			continue
		}
		if _, err := s.db.Exec(ctx, "DELETE FROM pr_project_releases WHERE project_id=$1 AND id=$2 AND NOT active", p.ID, id); err != nil {
			return err
		}
		if err := root.RemoveAll("releases/" + relative); err != nil {
			return err
		}
	}
	return nil
}

func writeProjectZip(writer io.Writer, source string) error {
	root, err := os.OpenRoot(source)
	if err != nil {
		return err
	}
	defer root.Close()
	z := zip.NewWriter(writer)
	err = fs.WalkDir(root.FS(), ".", func(name string, entry fs.DirEntry, err error) error {
		if err != nil || name == "." || !entry.Type().IsRegular() {
			return err
		}
		file, err := root.Open(name)
		if err != nil {
			return err
		}
		defer file.Close()
		out, err := z.Create(name)
		if err != nil {
			return err
		}
		_, err = io.Copy(out, file)
		return err
	})
	return errors.Join(err, z.Close())
}

func differentHash(a, b *string) bool {
	if a == nil || b == nil {
		return a != b
	}
	return *a != *b
}

func versionResult(current, next project, impact projectImpact, action, backup, message string) map[string]any {
	return map[string]any{
		"id": next.ID, "name": next.Name, action: true, "backup_id": backup, "source_hash_changed": current.SourceHash != next.SourceHash,
		"requirements_changed":  differentHash(current.RequirementsHash, next.RequirementsHash),
		"old_requirements_hash": current.RequirementsHash, "new_requirements_hash": next.RequirementsHash,
		"entry_candidates": next.Metadata.EntryCandidates, "dependency_files": next.Metadata.DependencyFiles,
		"impacted_tasks": impact.Tasks, "missing_entry_tasks": impact.Missing, "message": message,
	}
}
