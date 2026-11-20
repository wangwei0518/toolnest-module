package main

import (
	"fmt"
	"hash/fnv"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/robfig/cron/v3"
)

var standardCron = cron.NewParser(cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow)
var cronHash = regexp.MustCompile(`^H(?:\(([0-9]+)-([0-9]+)\))?(?:/([0-9]+))?$`)

type cronDays struct {
	days               uint64
	weekdays           uint8
	lastDay            bool
	lastWeekdays       uint8
	nth                [7]uint8
	anyDay, anyWeekday bool
}

func nextCron(expression string, now time.Time, location *time.Location) (time.Time, error) {
	fields := strings.Fields(expression)
	if len(fields) != 5 {
		return time.Time{}, badRequest("Cron 表达式必须包含 5 个字段。")
	}
	if err := expandCronHashes(fields, expression); err != nil {
		return time.Time{}, badRequest("Cron 表达式无效：" + err.Error())
	}
	days, err := parseCronDays(fields[2], fields[4])
	if err != nil {
		return time.Time{}, badRequest("Cron 表达式无效：" + err.Error())
	}
	plan, err := standardCron.Parse(strings.Join([]string{fields[0], fields[1], "*", fields[3], "*"}, " "))
	if err != nil {
		return time.Time{}, badRequest("Cron 表达式无效：" + err.Error())
	}
	current := now.In(location)
	end := current.AddDate(5, 0, 0)
	for candidate := plan.Next(current); !candidate.IsZero() && candidate.Before(end); {
		if days.matches(candidate) {
			return candidate.UTC(), nil
		}
		y, m, d := candidate.Date()
		// Starting just before the following local day avoids scanning every
		// minute on dates that fail the calendar filter.
		midnight := time.Date(y, m, d+1, 0, 0, 0, 0, location)
		next := midnight.Add(-time.Nanosecond)
		if !next.After(candidate) {
			next = candidate
		}
		candidate = plan.Next(next)
	}
	return time.Time{}, badRequest("Cron 表达式没有可用的执行时间。")
}

func expandCronHashes(fields []string, expression string) error {
	lower := [5]int{0, 0, 1, 1, 0}
	upper := [5]int{59, 23, 31, 12, 7}
	for i, field := range fields {
		items := strings.Split(field, ",")
		for j, item := range items {
			parts := cronHash.FindStringSubmatch(item)
			if parts == nil {
				continue
			}
			first, last := lower[i], upper[i]
			if parts[1] != "" {
				first, _ = strconv.Atoi(parts[1])
				last, _ = strconv.Atoi(parts[2])
			}
			if first < lower[i] || last > upper[i] || first > last {
				return fmt.Errorf("H 范围无效")
			}
			width := last - first + 1
			count := width
			step := 0
			if parts[3] != "" {
				step, _ = strconv.Atoi(parts[3])
				if step < 1 || step > width {
					return fmt.Errorf("H 步长无效")
				}
				count = step
			}
			h := fnv.New32a()
			_, _ = fmt.Fprintf(h, "%s:%d:%d", expression, i, j)
			value := first + int(h.Sum32()%uint32(count))
			items[j] = strconv.Itoa(value)
			if step > 0 {
				items[j] = fmt.Sprintf("%d-%d/%d", value, last, step)
			}
		}
		fields[i] = strings.Join(items, ",")
	}
	return nil
}

func parseCronDays(dom, dow string) (cronDays, error) {
	result := cronDays{anyDay: dom == "*" || dom == "?", anyWeekday: dow == "*" || dow == "?"}
	for _, value := range strings.Split(dom, ",") {
		if strings.EqualFold(value, "L") {
			result.lastDay = true
			continue
		}
		plan, err := standardCron.Parse("0 0 " + value + " * *")
		if err != nil {
			return result, err
		}
		result.days |= plan.(*cron.SpecSchedule).Dom
		if strings.HasPrefix(value, "*") || strings.HasPrefix(value, "?") {
			result.anyDay = true
		}
	}
	weekdays := strings.NewReplacer("SUN", "0", "MON", "1", "TUE", "2", "WED", "3", "THU", "4", "FRI", "5", "SAT", "6")
	for _, value := range strings.Split(strings.ToUpper(dow), ",") {
		value = weekdays.Replace(value)
		if day, ordinal, ok := strings.Cut(value, "#"); ok {
			number, e1 := strconv.Atoi(day)
			nth, e2 := strconv.Atoi(ordinal)
			if e1 != nil || e2 != nil || number < 0 || number > 7 || nth < 1 || nth > 5 {
				return result, fmt.Errorf("无效的星期序数")
			}
			result.nth[number%7] |= 1 << nth
			continue
		}
		if strings.HasSuffix(value, "L") {
			number, err := strconv.Atoi(strings.TrimSuffix(value, "L"))
			if err != nil || number < 0 || number > 7 {
				return result, fmt.Errorf("无效的月末星期")
			}
			result.lastWeekdays |= 1 << (number % 7)
			continue
		}
		// Use the standard range parser while allowing cron-parser's Sunday
		// alias 7. Only the low eight bits are valid weekday values.
		if strings.HasPrefix(value, "*") || strings.HasPrefix(value, "?") {
			result.anyWeekday = true
			value = "0-7" + value[1:]
		} else if start, step, ok := strings.Cut(value, "/"); ok && !strings.Contains(start, "-") {
			value = start + "-7/" + step
		}
		plan, err := standardCron.Parse(value + " 0 * * *")
		if err != nil {
			return result, err
		}
		mask := plan.(*cron.SpecSchedule).Minute
		if mask == 0 || mask > 255 {
			return result, fmt.Errorf("星期范围应为 0 到 7")
		}
		result.weekdays |= uint8(mask&127) | uint8((mask>>7)&1)
	}
	return result, nil
}

func (d cronDays) matches(date time.Time) bool {
	y, month, day := date.Date()
	weekday := date.Weekday()
	last := time.Date(y, month+1, 0, 12, 0, 0, 0, date.Location()).Day()
	dom := d.days&(1<<day) != 0 || (d.lastDay && day == last)
	dow := d.weekdays&(1<<weekday) != 0 || (d.lastWeekdays&(1<<weekday) != 0 && day+7 > last) ||
		d.nth[weekday]&(1<<((day-1)/7+1)) != 0
	if d.anyDay || d.anyWeekday {
		return dom && dow
	}
	return dom || dow
}
