package main

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"time"
)

func pythonEnvironment(pairs ...string) []string {
	env := make([]string, 0, 9+len(pairs))
	for _, name := range []string{"PATH", "PATHEXT", "SystemRoot", "TEMP", "TMP"} {
		if value, ok := os.LookupEnv(name); ok {
			env = append(env, name+"="+value)
		}
	}
	env = append(env, "PYTHONUNBUFFERED=1", "PYTHONIOENCODING=utf-8", "PYTHONUTF8=1")
	return append(env, pairs...)
}

func pythonCommand(ctx context.Context, executable, directory string, args, env []string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, executable, args...)
	cmd.Dir = directory
	cmd.Env = env
	cmd.WaitDelay = 3 * time.Second
	configureChild(cmd)
	cmd.Cancel = func() error {
		if err := killChildTree(cmd.Process); err != nil {
			if errors.Is(err, os.ErrProcessDone) {
				return os.ErrProcessDone
			}
			return cmd.Process.Kill()
		}
		return nil
	}
	return cmd
}
