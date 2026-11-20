package main

import (
	"context"
	"errors"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	installLogLimit  = 2 << 20
	installLogMarker = "\n[日志已截断]"
)

func venvPython(dir string) string {
	if runtime.GOOS == "windows" {
		return filepath.Join(dir, "Scripts", "python.exe")
	}
	return filepath.Join(dir, "bin", "python")
}

func (s *projectService) projectDir(id string) string {
	return filepath.Join(s.config.dataDir, "projects", id)
}

func requirementsPath(p project) (*string, error) {
	for _, name := range p.Metadata.DependencyFiles {
		if strings.EqualFold(path.Base(name), "requirements.txt") {
			relative, err := projectRelative(name)
			if err != nil {
				return nil, err
			}
			resolved, err := filepath.EvalSymlinks(filepath.Join(p.Root, filepath.FromSlash(relative)))
			if err != nil {
				return nil, err
			}
			base, err := filepath.EvalSymlinks(p.Root)
			if err != nil {
				return nil, err
			}
			rel, err := filepath.Rel(base, resolved)
			if err != nil || !filepath.IsLocal(rel) {
				return nil, badRequest("依赖文件必须位于项目目录内。")
			}
			return &resolved, nil
		}
	}
	return nil, nil
}

type environment struct {
	UploadID            string              `json:"upload_id"`
	Status              string              `json:"status"`
	Python              *string             `json:"python_executable"`
	VenvPath            string              `json:"venv_path"`
	ProjectDir          string              `json:"project_dir"`
	DataDir             string              `json:"data_dir"`
	DataSize            int64               `json:"data_size"`
	RequirementsPath    *string             `json:"requirements_path"`
	HasRequirements     bool                `json:"has_requirements"`
	RiskyRequirements   []map[string]string `json:"risky_requirements"`
	LastInstallStatus   *string             `json:"last_install_status"`
	LastInstallAt       *string             `json:"last_install_at"`
	LastInstallExitCode *int                `json:"last_install_exit_code"`
	LastError           *string             `json:"last_error"`
	RequirementsChanged bool                `json:"requirements_changed"`
	CreatedAt           *string             `json:"created_at"`
	UpdatedAt           *string             `json:"updated_at"`
}

func (s *projectService) environment(ctx context.Context, p project) (environment, error) {
	e := environment{UploadID: p.ID, Status: "missing", VenvPath: filepath.Join(s.projectDir(p.ID), "venv"),
		ProjectDir: p.Root, DataDir: filepath.Join(s.projectDir(p.ID), "data"), RiskyRequirements: []map[string]string{}}
	var created, updated, installed *time.Time
	var storedHash *string
	err := s.db.QueryRow(ctx, `SELECT status,python_executable,venv_path,requirements_hash,last_install_status,
		last_install_at,last_install_exit_code,last_error,created_at,updated_at FROM pr_environment_states WHERE project_id=$1`, p.ID).Scan(
		&e.Status, &e.Python, &e.VenvPath, &storedHash, &e.LastInstallStatus, &installed, &e.LastInstallExitCode, &e.LastError, &created, &updated)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return e, err
	}
	e.CreatedAt, e.UpdatedAt, e.LastInstallAt = optionalTime(created), optionalTime(updated), optionalTime(installed)
	if e.Python == nil {
		file := venvPython(e.VenvPath)
		if info, err := os.Stat(file); err == nil && info.Mode().IsRegular() {
			e.Python = &file
		}
	}
	e.RequirementsPath, err = requirementsPath(p)
	if err != nil {
		return e, err
	}
	e.HasRequirements = e.RequirementsPath != nil
	e.RequirementsChanged = p.RequirementsHash != nil && (storedHash == nil || *storedHash != *p.RequirementsHash)
	e.DataSize = sizeOfDirectory(e.DataDir)
	scan, err := s.projectScan(ctx, p, false)
	if err != nil {
		return e, err
	}
	for _, finding := range scan.Findings {
		if finding.Category != "requirements" {
			continue
		}
		line := ""
		if finding.Line != nil {
			line = strconv.Itoa(*finding.Line)
		}
		e.RiskyRequirements = append(e.RiskyRequirements, map[string]string{
			"line": line, "token": finding.Token, "content": finding.Content, "level": finding.Level, "scan_id": scan.ID,
		})
	}
	return e, nil
}

func optionalTime(t *time.Time) *string {
	if t == nil {
		return nil
	}
	value := formatTime(*t)
	return &value
}

func (s *projectService) createEnvironment(ctx context.Context, p project) error {
	dir := filepath.Join(s.projectDir(p.ID), "venv")
	requirements, err := requirementsPath(p)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(ctx, `INSERT INTO pr_environment_states (project_id,status,venv_path,requirements_path,requirements_hash)
		VALUES ($1,'creating',$2,$3,$4) ON CONFLICT (project_id) DO UPDATE
		SET status='creating',venv_path=$2,requirements_path=$3,requirements_hash=$4,python_executable=NULL,updated_at=NOW()`,
		p.ID, dir, requirements, p.RequirementsHash)
	if err != nil {
		return err
	}
	err = s.removeProjectDirectory(p, "venv")
	if err == nil {
		_, _, err = runEnvironmentCommand(ctx, s.config.python, p.Root, []string{"-m", "venv", dir}, 180*time.Second)
	}
	persist, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if err != nil {
		_, saveErr := s.db.Exec(persist, "UPDATE pr_environment_states SET status='failed',last_error=$1,updated_at=NOW() WHERE project_id=$2", err.Error(), p.ID)
		if saveErr != nil {
			return saveErr
		}
		return badRequest("创建 Python 虚拟环境失败：" + err.Error())
	}
	_, err = s.db.Exec(persist, "UPDATE pr_environment_states SET status='ready',python_executable=$1,last_error=NULL,updated_at=NOW() WHERE project_id=$2", venvPython(dir), p.ID)
	return err
}

func (s *projectService) removeProjectDirectory(p project, name string) error {
	root, err := os.OpenRoot(s.config.dataDir)
	if err != nil {
		return err
	}
	defer root.Close()
	return root.RemoveAll("projects/" + p.ID + "/" + name)
}

func (s *projectService) deleteEnvironment(ctx context.Context, p project) error {
	if err := s.removeProjectDirectory(p, "venv"); err != nil {
		return err
	}
	_, err := s.db.Exec(ctx, "DELETE FROM pr_environment_states WHERE project_id=$1", p.ID)
	return err
}

func (s *projectService) installRequirements(ctx context.Context, p project, confirmation securityConfirmation) error {
	scan, err := s.projectScan(ctx, p, false)
	if err != nil {
		return err
	}
	if err := scan.require(confirmation, "安装依赖"); err != nil {
		return err
	}
	e, err := s.environment(ctx, p)
	if err != nil {
		return err
	}
	if e.Python == nil {
		if err := s.createEnvironment(ctx, p); err != nil {
			return err
		}
		path := venvPython(filepath.Join(s.projectDir(p.ID), "venv"))
		e.Python = &path
	}
	if e.RequirementsPath == nil {
		return nil
	}
	log := s.installLogPath(p)
	if err := os.MkdirAll(filepath.Dir(log), 0700); err != nil {
		return err
	}
	if err := os.WriteFile(log, nil, 0600); err != nil {
		return err
	}
	content, exit, runErr := runEnvironmentCommand(ctx, *e.Python, p.Root,
		[]string{"-m", "pip", "install", "--disable-pip-version-check", "--no-input", "--requirement", *e.RequirementsPath}, 600*time.Second)
	logErr := os.WriteFile(log, []byte(content), 0600)
	persist, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if runErr != nil {
		_, err = s.db.Exec(persist, `UPDATE pr_environment_states SET last_install_status='failed',last_install_at=NOW(),
			last_install_exit_code=$1,last_error=$2,updated_at=NOW() WHERE project_id=$3`, exit, runErr.Error(), p.ID)
		if err != nil {
			return err
		}
		return badRequest("安装 Python 依赖失败：" + runErr.Error())
	}
	_, err = s.db.Exec(persist, `UPDATE pr_environment_states SET status='ready',requirements_hash=$1,last_install_status='success',
		last_install_at=NOW(),last_install_exit_code=0,last_error=NULL,updated_at=NOW() WHERE project_id=$2`, p.RequirementsHash, p.ID)
	return errors.Join(err, logErr)
}

func (s *projectService) installLogPath(p project) string {
	return filepath.Join(s.config.logDir, "projects", p.ID+".install.log")
}

func runEnvironmentCommand(ctx context.Context, python, dir string, args []string, limit time.Duration) (string, int, error) {
	ctx, cancel := context.WithTimeout(ctx, limit)
	defer cancel()
	out := outputBuffer{limit: installLogLimit}
	cmd := pythonCommand(ctx, python, dir, args, pythonEnvironment())
	cmd.Stdout, cmd.Stderr = &out, &out
	err := cmd.Run()
	out.finish()
	content, truncated := out.snapshot()
	if truncated {
		index := min(len(content), installLogLimit-len(installLogMarker))
		content = strings.ToValidUTF8(content[:index], "") + installLogMarker
	}
	exit := -1
	if cmd.ProcessState != nil {
		exit = cmd.ProcessState.ExitCode()
	}
	return content, exit, err
}

func readTail(name string, limit int64) (string, bool, error) {
	file, err := os.Open(name)
	if errors.Is(err, os.ErrNotExist) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return "", false, err
	}
	offset := max(0, info.Size()-limit)
	if _, err := file.Seek(offset, io.SeekStart); err != nil {
		return "", false, err
	}
	content, err := io.ReadAll(io.LimitReader(file, limit))
	return strings.ToValidUTF8(string(content), "�"), offset > 0, err
}

func sizeOfDirectory(name string) int64 {
	var size int64
	_ = filepath.WalkDir(name, func(_ string, entry fs.DirEntry, err error) error {
		if err == nil && entry.Type().IsRegular() {
			if info, err := entry.Info(); err == nil {
				size += info.Size()
			}
		}
		return nil
	})
	return size
}
