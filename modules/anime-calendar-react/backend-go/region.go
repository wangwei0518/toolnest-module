package main

import (
	"regexp"
	"strings"
)

var regionAliases = map[string]string{
	"日本": "jp", "日本动画": "jp", "日漫": "jp", "日本国": "jp", "japan": "jp", "japanese": "jp", "jp": "jp",
	"中国": "cn", "中国大陆": "cn", "国产": "cn", "国产动画": "cn", "国漫": "cn", "国创": "cn", "china": "cn", "cn": "cn",
	"韩国": "kr", "韓國": "kr", "韩国动画": "kr", "korea": "kr", "south korea": "kr", "kr": "kr",
	"欧美": "western", "欧美动画": "western", "美国": "western", "英国": "western", "法国": "western", "加拿大": "western",
	"德国": "western", "意大利": "western", "西班牙": "western", "usa": "western", "united states": "western",
	"united kingdom": "western", "france": "western", "canada": "western", "us": "western", "uk": "western",
}

var (
	japaneseStudio = regexp.MustCompile(`(?i)mappa|cloverworks|toei|bones|a-1 pictures|toho\s*animation\s*studio|\bolm\b`)
	westernStudio  = regexp.MustCompile(`(?i)disney|pixar|cartoon network`)
)

func inferRegion(raw map[string]any, tags []string, studio string) string {
	var countries []string
	for _, key := range []string{"country", "region", "country_of_origin"} {
		countries = appendRegionValues(countries, raw[key])
	}
	if fields, ok := raw["infobox"].([]any); ok {
		for _, value := range fields {
			field, _ := value.(map[string]any)
			switch strings.ToLower(stringValue(field["key"])) {
			case "国家", "地区", "国家/地区", "制作国家", "制作地区", "country", "region", "country of origin":
				countries = appendRegionValues(countries, field["value"])
			}
		}
	}
	var explicit []string
	for _, country := range countries {
		explicit = append(explicit, strings.FieldsFunc(country, func(r rune) bool {
			return strings.ContainsRune("/、,，;；", r)
		})...)
	}
	if origin := regionFromLabels(explicit); origin != "" {
		return origin
	}
	if origin := regionFromLabels(tags); origin != "" && origin != "unknown" {
		return origin
	}
	switch {
	case japaneseStudio.MatchString(studio):
		return "jp"
	case westernStudio.MatchString(studio):
		return "western"
	default:
		return "unknown"
	}
}

func appendRegionValues(values []string, raw any) []string {
	switch raw := raw.(type) {
	case string:
		return append(values, raw)
	case []any:
		for _, value := range raw {
			values = appendRegionValues(values, value)
		}
	case map[string]any:
		return appendRegionValues(values, firstValue(raw["v"], raw["value"]))
	}
	return values
}

func regionFromLabels(values []string) string {
	result := ""
	for _, value := range values {
		if region := regionAliases[strings.ToLower(strings.TrimSpace(value))]; region != "" {
			if result != "" && region != result {
				return "unknown"
			}
			result = region
		}
	}
	return result
}
