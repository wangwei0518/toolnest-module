package main

import (
	"context"
	"errors"
	"os/exec"
	"runtime"
	"testing"
	"time"
)

func TestPythonCommand(t *testing.T) {
	name := "python3"
	if runtime.GOOS == "windows" {
		name = "python"
	}
	python, err := exec.LookPath(name)
	if err != nil {
		t.Skip("requires Python on PATH")
	}
	t.Setenv("TOOLNEST_PLUGIN_TOKEN", "test-token")
	var stdout = outputBuffer{limit: 1024}
	var stderr = outputBuffer{limit: 1024}
	cmd := pythonCommand(t.Context(), python, t.TempDir(), []string{"-c", "import os, sys; assert 'TOOLNEST_PLUGIN_TOKEN' not in os.environ; print('\u4f60\u597d'); print('\u65e5\u5fd7', file=sys.stderr)"}, pythonEnvironment())
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Run(); err != nil {
		t.Fatal(err)
	}
	stdout.finish()
	stderr.finish()
	out, _ := stdout.snapshot()
	logs, _ := stderr.snapshot()
	if out != "你好\n" || logs != "日志\n" {
		t.Fatalf("stdout %q, stderr %q", out, logs)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 200*time.Millisecond)
	defer cancel()
	cmd = pythonCommand(ctx, python, t.TempDir(), []string{"-c", "import time; time.sleep(60)"}, pythonEnvironment())
	if err := cmd.Run(); err == nil || !errors.Is(ctx.Err(), context.DeadlineExceeded) {
		t.Fatalf("expected deadline to terminate Python, got %v with context %v", err, ctx.Err())
	}
}
