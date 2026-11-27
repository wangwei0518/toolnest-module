package main

import (
	"errors"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const maxGil = int64(24_000_000_000_000)

var beijing = time.FixedZone("UTC+8", 8*60*60)

type profile struct {
	Name         *string `json:"companyName"`
	World        *string `json:"companyWorld"`
	Rank         *int    `json:"companyRank"`
	GrandCompany *string `json:"companyGrandCompany"`
	LeaderName   *string `json:"companyLeaderName"`
	TotalMembers *int    `json:"companyTotalMembers"`
}
type item struct {
	ID       uint32 `json:"itemId"`
	Name     string `json:"name"`
	Quantity int64  `json:"quantity"`
	Price    *int64 `json:"npcUnitPriceGil"`
	Subtotal *int64 `json:"subtotalGil"`
}
type vessel struct {
	Slot int    `json:"slot"`
	Name string `json:"name"`
	Next *int64 `json:"nextCompletionTimestamp"`
}
type snapshot struct {
	Version   int    `json:"schemaVersion"`
	Event     string `json:"event"`
	CompanyID string `json:"companyId"`
	profile
	Date        string    `json:"date"`
	GeneratedAt time.Time `json:"generatedAt"`
	Trigger     string    `json:"trigger"`
	Total       int64     `json:"totalGil"`
	Items       []item    `json:"items"`
	Vessels     []vessel  `json:"submersibles"`
}
type fleet struct {
	GeneratedAt time.Time `json:"generatedAt"`
	Vessels     []vessel  `json:"submersibles"`
}
type incomeSummary struct {
	Date        string    `json:"date"`
	GeneratedAt time.Time `json:"generatedAt"`
	Trigger     string    `json:"trigger"`
	Total       int64     `json:"totalGil"`
}
type company struct {
	ID    string `json:"companyId"`
	Alias string `json:"alias"`
	profile
}
type dashboard struct {
	YesterdayTotal *int64         `json:"yesterdayTotalGil"`
	Today          string         `json:"today"`
	Now            time.Time      `json:"now"`
	Month          string         `json:"month"`
	Months         []string       `json:"months"`
	Company        company        `json:"company"`
	Latest         *snapshot      `json:"latest"`
	TodayReport    *snapshot      `json:"todayReport"`
	CurrentIncome  *incomeSummary `json:"currentIncome"`
	Fleet          *fleet         `json:"fleet"`
	Reports        []snapshot     `json:"reports"`
}

func validCompany(s string) bool {
	id, err := strconv.ParseUint(s, 10, 64)
	return err == nil && id > 0 && strconv.FormatUint(id, 10) == s
}
func validLabel(s string, max int) bool {
	return utf8.RuneCountInString(s) <= max && strings.IndexFunc(s, func(r rune) bool { return r < 32 || r == 127 }) < 0
}
func (s *snapshot) normalize(now time.Time) error {
	if s.Version != 1 || s.Event != "subvoyage.income.summary" {
		return errors.New("暂不支持此 schemaVersion 或 event")
	}
	if !validCompany(s.CompanyID) {
		return errors.New("companyId 应为有效的十进制部队 ID")
	}
	if s.GeneratedAt.IsZero() || s.GeneratedAt.Year() < 2010 || s.GeneratedAt.After(now.Add(5*time.Minute)) {
		return errors.New("generatedAt 必须有效，且不能晚于当前时间五分钟")
	}
	generatedDate := s.GeneratedAt.In(beijing).Format(time.DateOnly)
	if _, err := time.Parse(time.DateOnly, s.Date); err != nil || s.Date > generatedDate {
		s.Date = generatedDate
	}
	if s.Date > now.In(beijing).Format(time.DateOnly) {
		return errors.New("收益的北京时间日期不能晚于今天")
	}
	s.GeneratedAt = s.GeneratedAt.UTC()
	if s.Trigger != "manual" && s.Trigger != "completion" {
		return errors.New("trigger 无效")
	}
	if s.Items == nil || len(s.Items) > 2000 || s.Total < 0 || s.Total > maxGil {
		return errors.New("items 或 totalGil 无效")
	}
	for _, field := range []*string{s.Name, s.World, s.GrandCompany, s.LeaderName} {
		if field != nil && !validLabel(*field, 128) {
			return errors.New("部队资料过长或含有控制字符")
		}
	}
	if s.Rank != nil && (*s.Rank < 0 || *s.Rank > 255) ||
		s.TotalMembers != nil && (*s.TotalMembers < 0 || *s.TotalMembers > 65535) {
		return errors.New("部队等级或成员数无效")
	}
	seen := make(map[uint32]bool, len(s.Items))
	var total int64
	for _, i := range s.Items {
		if i.ID == 0 || seen[i.ID] || i.Quantity <= 0 || i.Quantity > 1_000_000_000 || !validLabel(i.Name, 200) || strings.TrimSpace(i.Name) == "" {
			return errors.New("items 中存在无效或重复的道具")
		}
		seen[i.ID] = true
		if i.Price == nil && i.Subtotal == nil {
			continue
		}
		if i.Price == nil || i.Subtotal == nil || *i.Price < 0 || *i.Price > maxGil/i.Quantity ||
			*i.Subtotal != *i.Price*i.Quantity || total > maxGil-*i.Subtotal {
			return errors.New("道具单价或小计不一致")
		}
		total += *i.Subtotal
	}
	if total != s.Total {
		return errors.New("totalGil 与道具小计合计不一致")
	}
	if len(s.Vessels) > 4 {
		return errors.New("submersibles 最多支持四个槽位")
	}
	slots := map[int]bool{}
	for _, v := range s.Vessels {
		if v.Slot < 1 || v.Slot > 4 || slots[v.Slot] || !validLabel(v.Name, 128) ||
			v.Next != nil && (*v.Next <= 0 || *v.Next > 253402300799) {
			return errors.New("潜水艇槽位、名称或时间无效")
		}
		slots[v.Slot] = true
	}
	sort.Slice(s.Items, func(i, j int) bool { return s.Items[i].ID < s.Items[j].ID })
	sort.Slice(s.Vessels, func(i, j int) bool { return s.Vessels[i].Slot < s.Vessels[j].Slot })
	return nil
}
