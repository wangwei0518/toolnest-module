package main

import (
	"encoding/json"
	"testing"
)

func TestNextScheduleTime(t *testing.T) {
	tests := []struct {
		name, planned, want string
		schedule            record
	}{
		{"monthly Shanghai 10:00", "2026-11-02T02:00:00.000Z", "2026-12-02T02:00:00.000Z", record{
			"schedule_type": "monthly", "timezone": "Asia/Shanghai", "day_of_month": json.Number("2"),
		}},
		{"skip short month", "2026-01-31T02:00:00.000Z", "2026-03-31T02:00:00.000Z", record{
			"schedule_type": "monthly", "timezone": "Asia/Shanghai", "day_of_month": json.Number("31"),
		}},
		{"daily across daylight saving", "2026-03-07T15:00:00.000Z", "2026-03-08T14:00:00.000Z", record{
			"schedule_type": "daily", "timezone": "America/New_York",
		}},
		{"weekly Sunday", "2026-11-02T02:00:00.000Z", "2026-11-08T02:00:00.000Z", record{
			"schedule_type": "weekly", "timezone": "Asia/Shanghai", "weekday": json.Number("0"),
		}},
		{"cron wraps to next hour", "2026-11-02T02:56:00.000Z", "2026-11-02T03:00:00.000Z", record{
			"schedule_type": "cron", "cron_expression": "*/7 * * * *",
		}},
		{"cron advances during repeated hour", "2026-11-01T06:30:00.000Z", "2026-11-01T06:31:00.000Z", record{
			"schedule_type": "cron", "timezone": "America/New_York", "cron_expression": "* * * * *",
		}},
		{"past end", "2026-11-02T02:00:00.000Z", "", record{
			"schedule_type": "daily", "end_at": "2026-11-02T23:59:00.000Z",
		}},
		{"once", "2026-11-02T02:00:00.000Z", "", record{"schedule_type": "once"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := nextScheduleTime(test.schedule, scheduleTimestamp(test.planned))
			actual := ""
			if !got.IsZero() {
				actual = timestamp(got)
			}
			if actual != test.want {
				t.Errorf("next schedule = %q, want %q", actual, test.want)
			}
		})
	}
}
