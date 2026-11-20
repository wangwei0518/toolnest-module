package main

import (
	"context"
	"os"
	"os/exec"
	"strconv"
	"syscall"
	"time"
)

func configureChild(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}

func killChildTree(child *os.Process) error {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	killer := exec.CommandContext(ctx, "taskkill", "/PID", strconv.Itoa(child.Pid), "/T", "/F")
	configureChild(killer)
	return killer.Run()
}
