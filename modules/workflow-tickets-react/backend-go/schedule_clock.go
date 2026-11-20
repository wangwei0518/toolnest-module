package main

import (
	"encoding/json"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata"
)

const timestampLayout = "2006-01-02T15:04:05.000Z"

func timestamp(at time.Time) string { return at.UTC().Format(timestampLayout) }

func scheduleTimestamp(value any) time.Time {
	raw, _ := value.(string)
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02T15:04:05", "2006-01-02T15:04", "2006-01-02"} {
		if parsed, err := time.Parse(layout, raw); err == nil {
			return parsed
		}
	}
	return time.Time{}
}

func scheduleLocation(value any) *time.Location {
	name, _ := value.(string)
	if name == "" {
		return time.UTC
	}
	location, err := time.LoadLocation(name)
	if err != nil {
		return time.UTC
	}
	return location
}

// Treat calendar calculations as local wall time before resolving them
// back into instants. A whole calendar day need not be 24 hours.
func wallClock(at time.Time) time.Time {
	return time.Date(at.Year(), at.Month(), at.Day(), at.Hour(), at.Minute(), at.Second(), 0, time.UTC)
}

func resolveWallClock(local time.Time, location *time.Location) time.Time {
	at := local
	for range 4 {
		correction := local.Sub(wallClock(at.In(location)))
		if correction == 0 {
			break
		}
		at = at.Add(correction)
	}
	return at
}

func nextScheduleTime(schedule record, planned time.Time) time.Time {
	if planned.IsZero() || schedule["schedule_type"] == "once" {
		return time.Time{}
	}
	zone := scheduleLocation(schedule["timezone"])
	wall := wallClock(planned.In(zone))
	var next time.Time
	switch schedule["schedule_type"] {
	case "daily":
		next = wall.AddDate(0, 0, 1)
	case "weekly":
		weekday := int(wall.Weekday())
		wanted := scheduleInt(schedule["weekday"], weekday)
		days := ((wanted%7 + 14 - weekday) % 7)
		if days == 0 {
			days = 7
		}
		next = wall.AddDate(0, 0, days)
	case "monthly":
		day := max(1, min(31, scheduleInt(schedule["day_of_month"], wall.Day())))
		first := time.Date(wall.Year(), wall.Month(), 1, wall.Hour(), wall.Minute(), wall.Second(), 0, time.UTC)
		for offset := 1; offset <= 24; offset++ {
			candidate := first.AddDate(0, offset, day-1)
			if candidate.Day() == day {
				next = candidate
				break
			}
		}
	case "cron":
		// The existing UI generates minute and hourly intervals. Retain
		// the legacy interpretation of persisted custom cron strings.
		expression, _ := schedule["cron_expression"].(string)
		minute := "*"
		if fields := strings.Fields(expression); len(fields) > 0 {
			minute = fields[0]
		}
		step := 60
		if raw, ok := strings.CutPrefix(minute, "*/"); ok && raw != "" && strings.Trim(raw, "0123456789") == "" {
			if n, err := strconv.Atoi(raw); err == nil {
				step = max(1, min(60, n))
			}
		} else if minute == "*" {
			step = 1
		}
		next = wall.Add(time.Minute)
		for next.Minute()%step != 0 {
			next = next.Add(time.Minute)
		}
	}
	if next.IsZero() {
		return next
	}
	candidate := resolveWallClock(next, zone)
	// During a clock rollback the legacy conversion may resolve an
	// ambiguous minute to the first occurrence, before the prior run.
	if !candidate.After(planned) {
		candidate = planned.Add(next.Sub(wall))
	}
	if end := scheduleTimestamp(schedule["end_at"]); !end.IsZero() && candidate.After(end) {
		return time.Time{}
	}
	return candidate
}

func scheduleInt(value any, fallback int) int {
	switch n := value.(type) {
	case int:
		return n
	case json.Number:
		if parsed, err := strconv.Atoi(n.String()); err == nil {
			return parsed
		}
	}
	return fallback
}
