package main

import (
	"fmt"
	"regexp"
	"time"
)

const dateLayout = "2006-01-02"

type cour struct {
	Year  int `json:"year"`
	Month int `json:"cour_month"`
}

func courAt(date time.Time) cour {
	return cour{date.Year(), 1 + (int(date.Month())-1)/3*3}
}

func (c cour) label() string {
	return fmt.Sprintf("%d年%d月新番", c.Year, c.Month)
}

func (c cour) key() string {
	return fmt.Sprintf("%d-%d", c.Year, c.Month)
}

func (c cour) valid() bool {
	return c.Month == 1 || c.Month == 4 || c.Month == 7 || c.Month == 10
}

func (c cour) bounds() (time.Time, time.Time) {
	start := time.Date(c.Year, time.Month(c.Month), 1, 0, 0, 0, 0, time.UTC)
	return start, start.AddDate(0, 3, -1)
}

type listItem struct {
	ID                string   `json:"id"`
	Provider          string   `json:"provider"`
	ProviderID        string   `json:"provider_id"`
	TitleCN           string   `json:"title_cn"`
	TitleOriginal     string   `json:"title_original"`
	CoverURL          string   `json:"cover_url"`
	Studio            string   `json:"studio"`
	Year              int      `json:"year"`
	CourMonth         int      `json:"cour_month"`
	CourLabel         string   `json:"cour_label"`
	AirDate           *string  `json:"air_date"`
	CourRelation      string   `json:"cour_relation"`
	CourRelationLabel string   `json:"cour_relation_label"`
	AirTime           string   `json:"air_time"`
	Weekday           int      `json:"weekday"`
	Status            string   `json:"status"`
	MediaType         string   `json:"media_type"`
	EpisodeCount      *int     `json:"episode_count"`
	CurrentEpisode    *int     `json:"current_episode"`
	Score             *float64 `json:"score"`
	ExternalURL       string   `json:"external_url"`
	Region            string   `json:"region"`
	MarkType          *string  `json:"mark_type"`
}

type animeItem struct {
	listItem
	TitleRomaji      string         `json:"title_romaji"`
	EstimatedEndDate *string        `json:"estimated_end_date"`
	AirMonth         string         `json:"air_month"`
	Summary          string         `json:"summary"`
	Tags             []string       `json:"tags"`
	Raw              map[string]any `json:"raw"`
	CreatedAt        string         `json:"created_at"`
	UpdatedAt        string         `json:"updated_at"`
}

func (i animeItem) episodesForEstimate() int {
	if i.EpisodeCount != nil {
		return *i.EpisodeCount
	}
	switch i.MediaType {
	case "movie", "ova", "sp", "unknown":
		return 1
	default:
		return 12
	}
}

func (i animeItem) estimatedEnd() *string {
	if i.AirDate != nil {
		if start, err := time.Parse(dateLayout, *i.AirDate); err == nil {
			end := start.AddDate(0, 0, max(0, i.episodesForEstimate()-1)*7).Format(dateLayout)
			return &end
		}
	}
	return i.EstimatedEndDate
}

func (i animeItem) forCour(c cour, activeWeekly bool) animeItem {
	start, end := c.bounds()
	i.EstimatedEndDate = i.estimatedEnd()
	i.Year, i.CourMonth, i.CourLabel = c.Year, c.Month, c.label()
	i.CourRelation, i.CourRelationLabel = "unknown", "未定"
	if i.AirDate == nil {
		return i
	}
	airDate, err := time.Parse(dateLayout, *i.AirDate)
	if err != nil {
		return i
	}
	if !airDate.Before(start) && !airDate.After(end) {
		i.CourRelation, i.CourRelationLabel = "new_this_cour", "新番"
		return i
	}
	if !airDate.Before(start) {
		return i
	}
	span := i.episodesForEstimate() / 12
	activeLong := activeWeekly && i.Status == "airing" && i.MediaType == "tv" &&
		(i.EpisodeCount == nil || span >= 3)
	ended := i.EstimatedEndDate != nil && *i.EstimatedEndDate < start.Format(dateLayout)
	switch {
	case activeLong || (!ended && span >= 3):
		i.CourRelation, i.CourRelationLabel = "long_running", "长期"
	case !ended && span == 2:
		i.CourRelation, i.CourRelationLabel = "continuing", "续播"
	}
	return i
}

var movieTitle = regexp.MustCompile(`(?i)剧场版|电影|theatrical|movie`)

func (i animeItem) isSingleEpisodeNonMovie() bool {
	return i.EpisodeCount != nil && *i.EpisodeCount == 1 && i.MediaType != "movie" &&
		!movieTitle.MatchString(i.TitleCN+" "+i.TitleOriginal)
}

func (i animeItem) scheduledOn(date time.Time) bool {
	if i.MediaType != "tv" && i.MediaType != "ona" {
		return i.AirDate != nil && *i.AirDate == date.Format(dateLayout)
	}
	return i.Status == "airing" && i.Weekday == isoWeekday(date)
}

func isoWeekday(date time.Time) int {
	return (int(date.Weekday())+6)%7 + 1
}
