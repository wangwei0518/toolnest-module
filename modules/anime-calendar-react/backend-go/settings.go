package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"unicode/utf16"
)

type proxySettings struct {
	Enabled bool   `json:"enabled"`
	URL     string `json:"url"`
}

type notificationRule struct {
	Enabled           bool     `json:"enabled"`
	Channels          []string `json:"channels"`
	SendTime          string   `json:"sendTime"`
	IncludeContinuing bool     `json:"includeContinuing"`
	Regions           []string `json:"regions"`
	TitleTemplate     string   `json:"titleTemplate"`
	BodyTemplate      string   `json:"bodyTemplate"`
}

type courRule struct {
	notificationRule
	ScheduleMode string   `json:"scheduleMode"`
	OffsetDays   int      `json:"offsetDays"`
	MinScore     *float64 `json:"minScore"`
	MinimumCount int      `json:"minimumCount"`
}

type watchingRule struct {
	notificationRule
	DeliveryMode string `json:"deliveryMode"`
}

type notificationSettings struct {
	Cour     courRule     `json:"courRelease"`
	Watching watchingRule `json:"watchingUpdate"`
}

type settings struct {
	DataRefreshTime string               `json:"dataRefreshTime"`
	CacheRetention  int                  `json:"cacheRetentionDays"`
	DefaultPage     string               `json:"defaultPage"`
	DefaultRegion   string               `json:"defaultRegion"`
	DefaultSort     string               `json:"defaultSort"`
	DefaultView     string               `json:"defaultView"`
	ShowContinuing  bool                 `json:"showContinuing"`
	ShowUnknown     bool                 `json:"showUnknownRegion"`
	WeeklyRegion    string               `json:"weeklyRegion"`
	Proxy           proxySettings        `json:"proxy"`
	Notifications   notificationSettings `json:"notifications"`
}

func defaultSettings() settings {
	baseRule := func(title, body string) notificationRule {
		return notificationRule{
			Channels: []string{"default"}, SendTime: "09:00",
			IncludeContinuing: true, Regions: []string{"all"},
			TitleTemplate: title, BodyTemplate: body,
		}
	}
	return settings{
		DataRefreshTime: "04:00", CacheRetention: 90, DefaultPage: "cour",
		DefaultRegion: "all", DefaultSort: "default", DefaultView: "grid",
		ShowContinuing: true, WeeklyRegion: "all",
		Notifications: notificationSettings{
			Cour: courRule{
				notificationRule: baseRule("{year}年{cour_month}月新番已更新",
					"{cour_label}共收录 {total_count} 部作品，其中新番 {new_count} 部、续播 {continuing_count} 部。\n\n本期新番：\n{anime_list}\n\n查看详情：{module_url}"),
				ScheduleMode: "cour_first_day", MinimumCount: 1,
			},
			Watching: watchingRule{
				notificationRule: baseRule("今天有 {count} 部关注番安排放送",
					"{weekday}关注番：\n{anime_list}\n\n进入周历：{module_url}"),
				DeliveryMode: "digest",
			},
		},
	}
}

func decodeSettings(input json.RawMessage) (settings, error) {
	config := defaultSettings()
	input = bytes.TrimSpace(input)
	if len(input) == 0 || input[0] != '{' || json.Unmarshal(input, &config) != nil {
		return settings{}, errors.New("设置格式不正确")
	}
	return config, nil
}

var (
	clockPattern      = regexp.MustCompile(`^(?:[01][0-9]|2[0-3]):[0-5][0-9]$`)
	templateVariable  = regexp.MustCompile(`\{([^{}]+)\}`)
	regions           = []string{"all", "jp", "cn", "western", "kr", "other", "unknown"}
	channels          = []string{"default", "web_internal", "qqbot", "email"}
	courVariables     = strings.Fields("year cour_month cour_label total_count new_count continuing_count region anime_list refresh_time module_url")
	watchingVariables = strings.Fields("date weekday count anime_list region module_url anime_title anime_title_original score media_type cour_relation bangumi_url")
)

func (s settings) validate() error {
	if !slices.Contains([]string{"cour", "weekly"}, s.DefaultPage) ||
		!slices.Contains([]string{"grid", "list"}, s.DefaultView) ||
		!slices.Contains([]string{"default", "score"}, s.DefaultSort) {
		return errors.New("展示偏好包含不支持的选项")
	}
	if s.CacheRetention != 0 && s.CacheRetention != 30 && s.CacheRetention != 90 {
		return errors.New("缓存周期包含不支持的选项")
	}
	if !clockPattern.MatchString(s.DataRefreshTime) {
		return errors.New("每日自动更新时间必须使用 HH:mm 格式")
	}
	if s.Proxy.Enabled {
		parsed, err := url.Parse(strings.TrimSpace(s.Proxy.URL))
		if err != nil || parsed.Hostname() == "" || !slices.Contains([]string{"http", "https", "socks5", "socks5h"}, parsed.Scheme) {
			return errors.New("代理地址必须是有效的 http、https、socks5 或 socks5h URL")
		}
	}
	if !slices.Contains(regions, s.DefaultRegion) || !slices.Contains(regions, s.WeeklyRegion) {
		return errors.New("默认地区包含不支持的选项")
	}
	cour, watching := s.Notifications.Cour, s.Notifications.Watching
	if err := cour.notificationRule.validate(courVariables); err != nil {
		return err
	}
	if err := watching.notificationRule.validate(watchingVariables); err != nil {
		return err
	}
	if cour.OffsetDays < -30 || cour.OffsetDays > 30 {
		return errors.New("提前天数必须在 -30 到 30 之间")
	}
	if cour.ScheduleMode != "cour_first_day" && cour.ScheduleMode != "offset" {
		return errors.New("季度通知日期模式不受支持")
	}
	if cour.MinScore != nil && (*cour.MinScore < 0 || *cour.MinScore > 10) {
		return errors.New("最低评分必须在 0 到 10 之间")
	}
	if cour.MinimumCount < 0 || cour.MinimumCount > 999 {
		return errors.New("最少番剧数必须在 0 到 999 之间")
	}
	if watching.DeliveryMode != "digest" && watching.DeliveryMode != "single" {
		return errors.New("关注通知发送模式不受支持")
	}
	return nil
}

func (rule notificationRule) validate(variables []string) error {
	if !clockPattern.MatchString(rule.SendTime) {
		return errors.New("发送时间必须使用 HH:mm 格式")
	}
	if len(utf16.Encode([]rune(rule.TitleTemplate))) > 4000 || len(utf16.Encode([]rune(rule.BodyTemplate))) > 4000 {
		return errors.New("通知模板不能超过 4000 个字符")
	}
	if len(rule.Channels) == 0 || (len(rule.Channels) > 1 && slices.Contains(rule.Channels, "default")) {
		return errors.New("通知渠道包含不支持的选项")
	}
	for _, channel := range rule.Channels {
		if !slices.Contains(channels, channel) {
			return errors.New("通知渠道包含不支持的选项")
		}
	}
	if rule.Regions == nil {
		return errors.New("通知地区包含不支持的选项")
	}
	for _, region := range rule.Regions {
		if !slices.Contains(regions, region) {
			return errors.New("通知地区包含不支持的选项")
		}
	}
	for _, token := range templateVariable.FindAllStringSubmatch(rule.TitleTemplate+rule.BodyTemplate, -1) {
		if !slices.Contains(variables, token[1]) {
			return fmt.Errorf("未知模板变量：%s", token[0])
		}
	}
	return nil
}
