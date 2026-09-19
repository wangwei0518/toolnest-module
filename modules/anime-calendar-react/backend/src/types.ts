export type AnimeStatus = "not_started" | "airing" | "finished" | "unknown";
export type AnimeMediaType = "tv" | "movie" | "ova" | "ona" | "sp" | "unknown";
export type AnimeMarkType = "watching" | "ignored";
export type AnimeCourRelation = "new_this_cour" | "continuing" | "long_running" | "unknown";
export type AnimeCacheStatus = "fresh" | "stale" | "empty" | "refreshing" | "failed";
export type AnimeRegion = "jp" | "cn" | "western" | "kr" | "other" | "unknown";

export interface AnimeItem {
  id: string;
  provider: "bangumi";
  provider_id: string;
  title_cn: string;
  title_original: string;
  title_romaji: string;
  cover_url: string;
  studio: string;
  year: number;
  cour_month: number;
  cour_label: string;
  air_date: string | null;
  estimated_end_date: string | null;
  cour_relation: AnimeCourRelation;
  cour_relation_label: string;
  air_time: string;
  air_month: string;
  weekday: number;
  status: AnimeStatus;
  media_type: AnimeMediaType;
  episode_count: number | null;
  current_episode: number | null;
  score: number | null;
  summary: string;
  tags: string[];
  external_url: string;
  region: AnimeRegion;
  raw: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  mark_type: AnimeMarkType | null;
}

export type AnimeListItem = Omit<AnimeItem, "title_romaji" | "estimated_end_date" | "air_month" | "summary" | "tags" | "raw" | "created_at" | "updated_at">;

export interface CourCache {
  year: number;
  cour_month: number;
  candidate_start: string | null;
  candidate_end: string | null;
  last_refreshed_at: string | null;
  refresh_status: "success" | "refreshing" | "failed" | "empty";
  fetched_count: number;
  unique_count: number;
  included_count: number;
  new_this_cour_count: number;
  continuing_count: number;
  long_running_count: number;
  unknown_count: number;
  skipped_count: number;
  error_message: string;
}

export interface DataCache {
  cache_date: string;
  updated_at: string;
  items: AnimeItem[];
}

export interface NotificationRuleBase {
  enabled: boolean;
  channels: string[];
  sendTime: string;
  includeContinuing: boolean;
  regions: string[];
  titleTemplate: string;
  bodyTemplate: string;
}

export interface AnimeSettings {
  autoFetchEmptyCour: boolean;
  autoRefreshCurrentCour: boolean;
  cacheRetentionDays: 0 | 30 | 90;
  defaultPage: "cour" | "weekly";
  defaultRegion: string;
  defaultSort: "default" | "score";
  defaultView: "grid" | "list";
  refreshIntervalHours: 12 | 24 | 168;
  showContinuing: boolean;
  showUnknownRegion: boolean;
  weeklyRegion: string;
  proxy: { enabled: boolean; url: string };
  notifications: {
    courRelease: NotificationRuleBase & {
      scheduleMode: "cour_first_day" | "offset";
      offsetDays: number;
      minScore: number | null;
      minimumCount: number;
    };
    watchingUpdate: NotificationRuleBase & { deliveryMode: "digest" | "single" };
  };
}

export const defaultSettings: AnimeSettings = {
  autoFetchEmptyCour: true,
  autoRefreshCurrentCour: false,
  cacheRetentionDays: 90,
  defaultPage: "cour",
  defaultRegion: "all",
  defaultSort: "default",
  defaultView: "grid",
  refreshIntervalHours: 24,
  showContinuing: true,
  showUnknownRegion: false,
  weeklyRegion: "all",
  proxy: { enabled: false, url: "" },
  notifications: {
    courRelease: {
      enabled: false,
      channels: ["default"],
      scheduleMode: "cour_first_day",
      offsetDays: 0,
      sendTime: "09:00",
      includeContinuing: true,
      regions: ["all"],
      minScore: null,
      minimumCount: 1,
      titleTemplate: "{year}年{cour_month}月新番已更新",
      bodyTemplate: "{cour_label}共收录 {total_count} 部作品，其中新番 {new_count} 部、续播 {continuing_count} 部。\n\n本期新番：\n{anime_list}\n\n查看详情：{module_url}",
    },
    watchingUpdate: {
      enabled: false,
      channels: ["default"],
      sendTime: "09:00",
      deliveryMode: "digest",
      includeContinuing: true,
      regions: ["all"],
      titleTemplate: "今天有 {count} 部关注番安排放送",
      bodyTemplate: "{weekday}关注番：\n{anime_list}\n\n进入周历：{module_url}",
    },
  },
};

export interface StoreState {
  items: AnimeItem[];
  marks: Record<string, AnimeMarkType>;
  courCaches: Record<string, CourCache>;
  weeklyCache: DataCache | null;
  todayCache: DataCache | null;
  longRunningCache: DataCache | null;
  detailCache: Record<string, { cached_at: string; item: AnimeItem }>;
  settings: AnimeSettings;
  notificationHistory: Record<string, { sent_at: string; notification_id: string | null }>;
}
