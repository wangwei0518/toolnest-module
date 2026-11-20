//go:build !windows

package main

import "os"

func parentAlive(pid int) bool { return os.Getppid() == pid }
