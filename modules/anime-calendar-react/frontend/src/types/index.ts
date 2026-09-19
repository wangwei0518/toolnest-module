export type AnimeStatus = "not_started" | "airing" | "finished" | "unknown";
export type AnimeMediaType = "tv" | "movie" | "ova" | "ona" | "sp" | "unknown";
export type AnimeMarkType = "watching" | "ignored";
export type AnimeCourRelation = "new_this_cour" | "continuing" | "long_running" | "unknown";
export type AnimeCacheStatus = "fresh" | "stale" | "empty" | "refreshing" | "failed";
export type AnimeRegion = "jp" | "cn" | "western" | "kr" | "other" | "unknown";

export interface AnimeListItem {
  id: string; provider: string; provider_id: string; title_cn: string; title_original: string; cover_url: string;
  studio: string; year: number; cour_month: number; cour_label: string; air_date: string | null;
  cour_relation: AnimeCourRelation; cour_relation_label: string; air_time: string; weekday: number;
  status: AnimeStatus; media_type: AnimeMediaType; episode_count: number | null; current_episode: number | null;
  score: number | null; external_url: string; region: AnimeRegion; mark_type: AnimeMarkType | null;
}
export interface AnimeDetail extends AnimeListItem { title_romaji: string; estimated_end_date: string | null; air_month: string; summary: string; tags: string[]; raw: Record<string, unknown>; created_at: string; updated_at: string; }
export interface ItemsResponse { year: number; cour_month: number; cour_label: string; date_range: { start_date: string; end_date: string }; cache_status: AnimeCacheStatus; cache_message: string; last_refreshed_at: string | null; total: number; items: AnimeListItem[]; }
export interface WeeklyDay { weekday: number; label: string; items: AnimeListItem[]; }
export interface WeeklyResponse { source: string; updated_at: string; total: number; days: WeeklyDay[]; }
export interface TodayResponse { source: string; date: string; updated_at: string; total: number; items: AnimeListItem[]; }
export interface RefreshResponse { year: number; cour_month: number; cour_label: string; cache_status: AnimeCacheStatus; fetched_count: number; included_count: number; inserted: number; updated: number; total: number; last_refreshed_at: string | null; }
export interface NotificationRuleBase { enabled: boolean; channels: string[]; sendTime: string; includeContinuing: boolean; regions: string[]; titleTemplate: string; bodyTemplate: string; }
export interface AnimeSettings { autoFetchEmptyCour: boolean; autoRefreshCurrentCour: boolean; cacheRetentionDays: 0 | 30 | 90; defaultPage: "cour" | "weekly"; defaultRegion: string; defaultSort: "default" | "score"; defaultView: "grid" | "list"; refreshIntervalHours: 12 | 24 | 168; showContinuing: boolean; showUnknownRegion: boolean; weeklyRegion: string; proxy: { enabled: boolean; url: string }; notifications: { courRelease: NotificationRuleBase & { scheduleMode: "cour_first_day" | "offset"; offsetDays: number; minScore: number | null; minimumCount: number }; watchingUpdate: NotificationRuleBase & { deliveryMode: "digest" | "single" } }; }

export const defaultAnimeSettings: AnimeSettings = {
  autoFetchEmptyCour: true, autoRefreshCurrentCour: false, cacheRetentionDays: 90, defaultPage: "cour", defaultRegion: "all", defaultSort: "default", defaultView: "grid", refreshIntervalHours: 24, showContinuing: true, showUnknownRegion: false, weeklyRegion: "all", proxy: { enabled: false, url: "" },
  notifications: {
    courRelease: { enabled: false, channels: ["default"], scheduleMode: "cour_first_day", offsetDays: 0, sendTime: "09:00", includeContinuing: true, regions: ["all"], minScore: null, minimumCount: 1, titleTemplate: "{year}年{cour_month}月新番已更新", bodyTemplate: "{cour_label}共收录 {total_count} 部作品，其中新番 {new_count} 部、续播 {continuing_count} 部。\n\n本期新番：\n{anime_list}\n\n查看详情：{module_url}" },
    watchingUpdate: { enabled: false, channels: ["default"], sendTime: "09:00", deliveryMode: "digest", includeContinuing: true, regions: ["all"], titleTemplate: "今天有 {count} 部关注番安排放送", bodyTemplate: "{weekday}关注番：\n{anime_list}\n\n进入周历：{module_url}" },
  },
};
export interface NotificationTestResponse { ok: boolean; notification_id: string | null; message: string; deliveries: Array<{ channel: string; status: string; error_message?: string | null }>; }
