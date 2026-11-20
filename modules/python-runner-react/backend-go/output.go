package main

import (
	"strings"
	"sync"
	"unicode/utf8"
)

// outputBuffer decodes incrementally because a pipe read can end inside a rune.
type outputBuffer struct {
	mu          sync.Mutex
	text        strings.Builder
	pending     [utf8.UTFMax]byte
	pendingSize int
	limit       int
	truncated   bool
}

func (b *outputBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	n := len(p)
	if b.truncated {
		return n, nil
	}
	if b.pendingSize > 0 {
		p = append(append([]byte(nil), b.pending[:b.pendingSize]...), p...)
		b.pendingSize = 0
	}
	for len(p) > 0 && utf8.FullRune(p) {
		r, size := utf8.DecodeRune(p)
		if !b.appendRune(r) {
			return n, nil
		}
		p = p[size:]
	}
	b.pendingSize = copy(b.pending[:], p)
	return n, nil
}

func (b *outputBuffer) appendRune(r rune) bool {
	if b.text.Len()+utf8.RuneLen(r) > b.limit {
		b.truncated = true
		return false
	}
	b.text.WriteRune(r)
	return true
}

func (b *outputBuffer) finish() {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.pendingSize > 0 {
		b.appendRune(utf8.RuneError)
		b.pendingSize = 0
	}
}

func (b *outputBuffer) snapshot() (string, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.text.String(), b.truncated
}
