package main

import (
	"testing"
	"time"
)

func TestLegacyCronCalendarSyntax(t *testing.T) {
	now := time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)
	for _, tt := range []struct {
		expression string
		day        int
	}{
		{"0 0 L * *", 28},
		{"0 0 * * MON#2", 9},
		{"0 0 * * 5L", 27},
		{"0 0 * * 7", 8},
		{"0 0 10 * MON", 2},
		{"0 0 ? * MON", 2},
		{"0 0 * * 1-7/2", 2},
	} {
		got, err := nextCron(tt.expression, now, time.UTC)
		if err != nil || got.Month() != time.February || got.Day() != tt.day {
			t.Errorf("%s: got %v (%v), want February %d", tt.expression, got, err, tt.day)
		}
	}
	a, err := nextCron("H(5-20) * * * *", now, time.UTC)
	b, err2 := nextCron("H(5-20) * * * *", now, time.UTC)
	if err != nil || err2 != nil || !a.Equal(b) || a.Minute() < 5 || a.Minute() > 20 {
		t.Fatalf("invalid randomized minute: %v (%v), %v (%v)", a, err, b, err2)
	}
}
