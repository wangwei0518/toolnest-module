package main

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strings"
)

const (
	maxArchiveBytes     = 50 << 20
	maxUnpackedBytes    = 512 << 20
	maxProjectFileBytes = 64 << 20
	maxArchiveEntries   = 10000
	maxProjectFiles     = 5000
)

type projectFile struct {
	Name     string         `json:"name"`
	Path     string         `json:"path"`
	Type     string         `json:"type"`
	Children *[]projectFile `json:"children,omitempty"`
}

type projectMetadata struct {
	Filename         string        `json:"filename"`
	UploadSource     string        `json:"upload_source"`
	FileCount        int           `json:"file_count"`
	TotalSize        int64         `json:"total_size"`
	EntryCandidates  []string      `json:"entry_candidates"`
	PythonFiles      []string      `json:"python_files"`
	DependencyFiles  []string      `json:"dependency_files"`
	Tree             []projectFile `json:"file_tree"`
	SourceHash       string        `json:"source_hash"`
	RequirementsHash *string       `json:"requirements_hash"`
	UpdateCount      int           `json:"update_count"`
	LastBackupID     *string       `json:"last_backup_id"`
	ErrorMessage     *string       `json:"error_message"`
}

func extractArchive(ctx context.Context, filename, directory string) (projectMetadata, error) {
	var data projectMetadata
	z, err := zip.OpenReader(filename)
	if err != nil {
		return data, badRequest("项目压缩包格式无效。")
	}
	defer z.Close()
	if len(z.File) == 0 {
		return data, badRequest("项目压缩包为空。")
	}
	if len(z.File) > maxArchiveEntries {
		return data, badRequest("项目压缩包包含过多条目。")
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		return data, err
	}
	defer root.Close()
	var total uint64
	for _, entry := range z.File {
		if err := ctx.Err(); err != nil {
			return data, err
		}
		if entry.Mode()&os.ModeSymlink != 0 {
			return data, badRequest("项目压缩包不能包含符号链接。")
		}
		name, err := validateProjectRelative(strings.TrimRight(strings.ReplaceAll(entry.Name, "\\", "/"), "/"))
		if err != nil {
			return data, err
		}
		if strings.Count(name, "/") > 32 {
			return data, badRequest("项目目录层级过深。")
		}
		if entry.FileInfo().IsDir() {
			if err := root.MkdirAll(name, 0700); err != nil {
				return data, err
			}
			continue
		}
		if !entry.Mode().IsRegular() || entry.UncompressedSize64 > maxProjectFileBytes {
			return data, badRequest("项目文件过大或格式无效：" + name)
		}
		total += entry.UncompressedSize64
		if total > maxUnpackedBytes {
			return data, badRequest("项目解压后体积超过 512 MiB。")
		}
		if err := root.MkdirAll(path.Dir(name), 0700); err != nil {
			return data, err
		}
		if err := extractZipEntry(root, entry, name); err != nil {
			return data, err
		}
	}
	data, err = analyzeSource(root)
	data.TotalSize = int64(total)
	if err == nil && len(data.PythonFiles) == 0 {
		return data, badRequest("项目必须至少包含一个 .py 文件。")
	}
	return data, err
}

func extractZipEntry(root *os.Root, entry *zip.File, name string) error {
	input, err := entry.Open()
	if err != nil {
		return badRequest("项目文件无法解压：" + name)
	}
	defer input.Close()
	output, err := root.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return badRequest("项目文件重复或无法创建：" + name)
	}
	size, copyErr := io.Copy(output, io.LimitReader(input, int64(entry.UncompressedSize64)+1))
	closeErr := output.Close()
	if copyErr != nil || uint64(size) != entry.UncompressedSize64 {
		return badRequest("项目文件大小或校验值无效：" + name)
	}
	return closeErr
}

func analyzeSource(root *os.Root) (projectMetadata, error) {
	metadata := projectMetadata{
		Filename: "project.zip", UploadSource: "zip", EntryCandidates: []string{},
		PythonFiles: []string{}, DependencyFiles: []string{},
	}
	files := []string{}
	var tree func(string, int) ([]projectFile, error)
	tree = func(directory string, depth int) ([]projectFile, error) {
		if depth > 32 {
			return nil, badRequest("项目目录层级过深。")
		}
		entries, err := fs.ReadDir(root.FS(), directory)
		if err != nil {
			return nil, err
		}
		result := []projectFile{}
		for _, entry := range entries {
			if entry.Name() == ".git" || entry.Name() == "__pycache__" {
				continue
			}
			child := path.Join(directory, entry.Name())
			node := projectFile{Name: entry.Name(), Path: child, Type: "file"}
			if entry.IsDir() {
				children, err := tree(child, depth+1)
				if err != nil {
					return nil, err
				}
				node.Type, node.Children = "directory", &children
			} else if entry.Type().IsRegular() {
				files = append(files, child)
				if len(files) > maxProjectFiles {
					return nil, badRequest("项目文件数不能超过 5000。")
				}
			} else {
				continue
			}
			result = append(result, node)
		}
		return result, nil
	}
	var err error
	metadata.Tree, err = tree(".", 0)
	if err != nil {
		return metadata, err
	}
	slices.Sort(files)
	preferred := []string{"main.py", "app.py", "run.py", "__main__.py"}
	for _, name := range preferred {
		if slices.Contains(files, name) {
			metadata.EntryCandidates = append(metadata.EntryCandidates, name)
		}
	}
	preferredCount := len(metadata.EntryCandidates)
	allHash := sha256.New()
	requirementsHash := sha256.New()
	hasRequirements := false
	for _, name := range files {
		if strings.HasSuffix(strings.ToLower(name), ".py") {
			metadata.PythonFiles = append(metadata.PythonFiles, name)
			if !slices.Contains(preferred, name) && len(metadata.EntryCandidates)-preferredCount < 100 {
				metadata.EntryCandidates = append(metadata.EntryCandidates, name)
			}
		}
		base := strings.ToLower(path.Base(name))
		if slices.Contains([]string{"requirements.txt", "pyproject.toml", "setup.py"}, base) {
			metadata.DependencyFiles = append(metadata.DependencyFiles, name)
		}
		file, err := root.Open(name)
		if err != nil {
			return metadata, err
		}
		_, _ = io.WriteString(allHash, name+"\x00")
		writer := io.Writer(allHash)
		if base == "requirements.txt" {
			hasRequirements = true
			_, _ = io.WriteString(requirementsHash, name)
			writer = io.MultiWriter(allHash, requirementsHash)
		}
		size, err := io.Copy(writer, file)
		closeErr := file.Close()
		if err = errors.Join(err, closeErr); err != nil {
			return metadata, err
		}
		metadata.TotalSize += size
		_, _ = io.WriteString(allHash, "\x00")
	}
	metadata.FileCount = len(files)
	metadata.SourceHash = hex.EncodeToString(allHash.Sum(nil))
	if hasRequirements {
		hash := hex.EncodeToString(requirementsHash.Sum(nil))
		metadata.RequirementsHash = &hash
	}
	return metadata, nil
}

func copyProject(source *os.Root, destination string) error {
	return fs.WalkDir(source.FS(), ".", func(name string, entry fs.DirEntry, err error) error {
		if err != nil || name == "." {
			return err
		}
		target := filepath.Join(destination, filepath.FromSlash(name))
		if entry.IsDir() {
			return os.Mkdir(target, 0700)
		}
		if !entry.Type().IsRegular() {
			return nil
		}
		in, err := source.Open(name)
		if err != nil {
			return err
		}
		defer in.Close()
		out, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			return err
		}
		_, err = io.Copy(out, in)
		return errors.Join(err, out.Close())
	})
}
