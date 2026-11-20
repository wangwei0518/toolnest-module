package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"

	"github.com/gen2brain/webp"
)

var (
	ownerPattern  = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
	idPattern     = regexp.MustCompile(`^[0-9A-Fa-f-]{36}$`)
	errMissing    = errors.New("没有找到这张作品。")
	errProcessing = errors.New("壁纸还在生成中，请稍后再试。")
)

type record struct {
	ID             string   `json:"id"`
	Title          string   `json:"title"`
	SourceName     string   `json:"sourceName"`
	Format         string   `json:"format"`
	Width          int      `json:"width"`
	Height         int      `json:"height"`
	Frames         int      `json:"frames"`
	MotionPhoto    bool     `json:"motionPhoto"`
	MotionVideoKey string   `json:"motionVideoKey,omitempty"`
	Timestamp      *int64   `json:"presentationTimestampUs,omitempty"`
	Crop           cropRect `json:"crop"`
	State          string   `json:"state"`
	Error          *string  `json:"error"`
	JobID          *string  `json:"jobId"`
	CreatedAt      string   `json:"createdAt"`
	UpdatedAt      string   `json:"updatedAt"`
}

type summary struct {
	record
	OutputWidth  int    `json:"outputWidth"`
	OutputHeight int    `json:"outputHeight"`
	OutputFormat string `json:"outputFormat"`
}

func (r record) outputFormat() string {
	if r.MotionPhoto {
		return "jpg"
	}
	if r.Format == "gif" {
		return "gif"
	}
	return "png"
}
func (r record) summary() summary { return summary{r, targetWidth, targetHeight, r.outputFormat()} }

type job struct {
	ID          string  `json:"id"`
	WallpaperID string  `json:"wallpaperId"`
	State       string  `json:"state"`
	Progress    int     `json:"progress"`
	Message     string  `json:"message"`
	Error       *string `json:"error"`
}

type jobKey struct{ owner, id string }

type store struct {
	root    string
	mu      sync.Mutex // Serializes index replacement and state transitions, not image processing.
	jobs    map[jobKey]job
	workers chan struct{}
	pending sync.WaitGroup
}

func (s *store) userDir(owner string) string { return filepath.Join(s.root, "users", owner) }
func (s *store) recordDir(owner string, r record) string {
	return filepath.Join(s.userDir(owner), r.ID)
}
func (s *store) indexPath(owner string) string {
	return filepath.Join(s.userDir(owner), "wallpapers.json")
}
func validFormat(format string) bool {
	return format == "jpg" || format == "png" || format == "webp" || format == "gif"
}
func (s *store) readIndex(owner string) ([]record, error) {
	if !ownerPattern.MatchString(owner) {
		return nil, errMissing
	}
	var records []record
	data, err := os.ReadFile(s.indexPath(owner))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(data, &records); err != nil {
		return nil, err
	}
	return records, nil
}
func findRecord(records []record, id string) int {
	if idPattern.MatchString(id) {
		for i, r := range records {
			if r.ID == id && validFormat(r.Format) {
				return i
			}
		}
	}
	return -1
}

func writeAtomic(path string, encode func(io.Writer) error) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".wallpaper-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if err := encode(f); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), path)
}
func (s *store) writeIndex(owner string, records []record) error {
	if records == nil {
		records = []record{}
	}
	return writeAtomic(s.indexPath(owner), func(w io.Writer) error { return json.NewEncoder(w).Encode(records) })
}
func now() string { return time.Now().UTC().Format("2006-01-02T15:04:05.000Z") }

func openStore(root string) (*store, error) {
	users := filepath.Join(root, "users")
	if err := os.MkdirAll(users, 0700); err != nil {
		return nil, err
	}
	dirs, err := os.ReadDir(users)
	if err != nil {
		return nil, err
	}
	s := &store{root: root, jobs: make(map[jobKey]job), workers: make(chan struct{}, 1)}
	type recovered struct {
		owner string
		r     record
	}
	var recovery []recovered
	for _, dir := range dirs {
		if !dir.IsDir() || !ownerPattern.MatchString(dir.Name()) {
			continue
		}
		records, err := s.readIndex(dir.Name())
		if err != nil {
			return nil, fmt.Errorf("read wallpaper index: %w", err)
		}
		for _, r := range records {
			if r.State == "processing" && r.JobID != nil && idPattern.MatchString(r.ID) && validFormat(r.Format) {
				recovery = append(recovery, recovered{dir.Name(), r})
			}
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, item := range recovery {
		s.schedule(item.owner, item.r)
	}
	return s, nil
}

// Caller holds mu. The persisted record is already processing before a worker starts.
func (s *store) schedule(owner string, r record) job {
	key := jobKey{owner, *r.JobID}
	queued := job{ID: key.id, WallpaperID: r.ID, State: "queued", Message: "等待生成壁纸"}
	s.jobs[key] = queued
	s.pending.Add(1)
	go func() {
		defer s.pending.Done()
		s.workers <- struct{}{}
		defer func() { <-s.workers }()
		s.progress(key, "正在读取图片帧", 8)
		err := s.render(owner, r, key)
		s.mu.Lock()
		defer s.mu.Unlock()
		final := s.jobs[key]
		records, readErr := s.readIndex(owner)
		if readErr == nil {
			idx := findRecord(records, r.ID)
			if idx >= 0 && records[idx].JobID != nil && *records[idx].JobID == key.id {
				item := &records[idx]
				item.UpdatedAt = now()
				item.State = "ready"
				if err != nil {
					log.Printf("wallpaper render %s: %v", r.ID, err)
					message := "图片处理失败，请重新调整裁切范围或换一张图片重试。"
					item.State, item.Error = "failed", &message
					final.Error = &message
				}
				readErr = s.writeIndex(owner, records)
			}
		}
		if err != nil || readErr != nil {
			final.State, final.Message = "failed", "图片生成失败"
			if final.Error == nil {
				message := "无法保存生成状态，请稍后重试。"
				final.Error = &message
			}
		} else {
			final.State, final.Message, final.Progress = "completed", "壁纸已生成", 100
		}
		s.jobs[key] = final
	}()
	return queued
}
func (s *store) progress(key jobKey, message string, value int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	j := s.jobs[key]
	j.State, j.Message, j.Progress = "running", message, value
	s.jobs[key] = j
}

func (s *store) render(owner string, r record, key jobKey) error {
	dir := s.recordDir(owner, r)
	source, err := os.ReadFile(filepath.Join(dir, "source."+r.Format))
	if err != nil {
		return err
	}
	info, err := inspectImage(source)
	if err != nil {
		return err
	}
	crop, err := normalizeCrop(&r.Crop, info.width, info.height)
	if err != nil {
		return err
	}
	s.progress(key, "正在按取景生成壁纸", 28)
	output := filepath.Join(dir, "wallpaper."+r.outputFormat())
	var preview func(io.Writer) error
	if r.Format == "gif" && !r.MotionPhoto {
		err = writeAtomic(output, func(w io.Writer) error {
			first, err := renderGIF(source, info, crop, w)
			if err == nil {
				preview = func(out io.Writer) error { return webp.Encode(out, first, webp.Options{Quality: 78}) }
			}
			return err
		})
	} else {
		still, decodeErr := decodeStill(source, info)
		if decodeErr != nil {
			return decodeErr
		}
		preview = func(w io.Writer) error { return encodePreview(w, still, crop) }
		err = writeAtomic(output, func(w io.Writer) error {
			if !r.MotionPhoto {
				return encodeStill(w, still, crop, false)
			}
			if !idPattern.MatchString(r.MotionVideoKey) {
				return errors.New("动态照片视频标识无效")
			}
			video, err := os.ReadFile(filepath.Join(dir, r.MotionVideoKey+".mp4"))
			if err != nil {
				return err
			}
			var jpeg bytes.Buffer
			if err := encodeStill(&jpeg, still, crop, true); err != nil {
				return err
			}
			return packageMotion(w, jpeg.Bytes(), video, r.Timestamp)
		})
	}
	if err != nil {
		return err
	}
	s.progress(key, "正在生成作品预览", 78)
	return writeAtomic(filepath.Join(dir, "preview.webp"), preview)
}
