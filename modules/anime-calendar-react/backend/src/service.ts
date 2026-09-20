import { createHash } from "node:crypto";

import { courLabel, courRange, currentCour, dateKey, validateCourMonth } from "./cour.js";
import { BangumiProvider } from "./provider.js";
import { mergeSettings, type AnimeStoreRepository } from "./store.js";
import {
  defaultSettings,
  type AnimeCacheStatus,
  type AnimeItem,
  type AnimeListItem,
  type AnimeMarkType,
  type AnimeSettings,
  type CourCache,
  type DataCache,
  type NotificationRuleBase,
} from "./types.js";

const weekdayLabels = ["未定", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const detailTtlMs = 7 * 24 * 60 * 60 * 1000;
const weeklyTtlMs = 30 * 60 * 1000;
const courTtlMs = 24 * 60 * 60 * 1000;

export class AnimeCalendarService {
  private weeklyPromise: Promise<AnimeItem[]> | null = null;
  private refreshPromises = new Map<string, Promise<unknown>>();

  constructor(
    private readonly store: AnimeStoreRepository,
    private readonly provider: BangumiProvider,
    private readonly moduleId: string,
    private readonly platformApiUrl: string,
    private readonly platformToken: string,
  ) {}

  currentCour() { return currentCour(platformNow()); }

  listItems(query: {
    year?: number; cour_month?: number; weekday?: number; status?: string; media_type?: string;
    keyword?: string; mark_type?: AnimeMarkType; include_ignored?: boolean;
  }) {
    const resolved = this.resolveCour(query.year, query.cour_month);
    const state = this.store.read();
    const items = this.itemsForCour(this.withMarks(state.items, state.marks), resolved.year, resolved.cour_month);
    const keyword = query.keyword?.trim().toLocaleLowerCase() ?? "";
    const filtered = items.filter((item) => {
      if (query.weekday !== undefined && item.weekday !== query.weekday) return false;
      if (query.status && item.status !== query.status) return false;
      if (query.media_type && item.media_type !== query.media_type) return false;
      if (query.mark_type && item.mark_type !== query.mark_type) return false;
      if (!query.include_ignored && !query.mark_type && item.mark_type === "ignored") return false;
      if (!keyword) return true;
      return [item.title_cn, item.title_original, item.title_romaji, item.studio].some((value) => value.toLocaleLowerCase().includes(keyword));
    });
    const cache = state.courCaches[this.courKey(resolved.year, resolved.cour_month)];
    const range = courRange(resolved.year, resolved.cour_month);
    const cacheStatus = this.cacheStatus(cache, filtered.length);
    return {
      year: resolved.year,
      cour_month: resolved.cour_month,
      cour_label: courLabel(resolved.year, resolved.cour_month),
      date_range: { start_date: range.start_date, end_date: range.end_date },
      cache_status: cacheStatus,
      cache_message: cacheMessage(cacheStatus, cache?.error_message ?? ""),
      last_refreshed_at: cache?.last_refreshed_at ?? null,
      total: filtered.length,
      items: filtered.map(publicItem),
    };
  }

  async getItem(itemId: string) {
    const state = this.store.read();
    const base = this.withMarks(state.items, state.marks).find((item) => item.id === itemId)
      ?? state.weeklyCache?.items.find((item) => item.id === itemId)
      ?? state.longRunningCache?.items.find((item) => item.id === itemId);
    if (!base) throw httpError(404, "未找到该番剧");
    const cached = state.detailCache[itemId];
    if (cached && Date.now() - Date.parse(cached.cached_at) < detailTtlMs) return mergeDetail(base, cached.item, state.marks[itemId] ?? null);
    try {
      const detail = await this.provider.fetchDetail(base.provider_id);
      const merged = mergeDetail(base, detail, state.marks[itemId] ?? null);
      await this.store.update((next) => { next.detailCache[itemId] = { cached_at: nowIso(), item: { ...merged, mark_type: null } }; });
      return merged;
    } catch {
      return { ...base, mark_type: state.marks[itemId] ?? null };
    }
  }

  async weekly(force = false) {
    const state = this.store.read();
    if (!force && state.weeklyCache && Date.now() - Date.parse(state.weeklyCache.updated_at) < weeklyTtlMs) {
      return this.weeklyResponse(this.withMarks(state.weeklyCache.items, state.marks), state.weeklyCache.updated_at);
    }
    try {
      const items = await this.weeklyItems(force);
      const next = this.store.read();
      return this.weeklyResponse(this.withMarks(items, next.marks), next.weeklyCache?.updated_at ?? nowIso());
    } catch (error) {
      if (state.weeklyCache) return this.weeklyResponse(this.withMarks(state.weeklyCache.items, state.marks), state.weeklyCache.updated_at);
      throw error;
    }
  }

  async today() {
    const today = platformDateKey();
    const state = this.store.read();
    if (state.todayCache?.cache_date === today) return this.todayResponse(this.withMarks(state.todayCache.items, state.marks), state.todayCache.updated_at, today);
    const weekly = await this.weeklyItems(false);
    const weekday = platformWeekday();
    const items = weekly.filter((item) => item.weekday === weekday);
    const cache: DataCache = { cache_date: today, updated_at: nowIso(), items: items.map(clearMark) };
    await this.store.update((next) => { next.todayCache = cache; });
    const next = this.store.read();
    return this.todayResponse(this.withMarks(items, next.marks), cache.updated_at, today);
  }

  async refresh(year?: number, courMonth?: number, force = false) {
    const resolved = this.resolveCour(year, courMonth);
    const key = this.courKey(resolved.year, resolved.cour_month);
    const existing = this.store.read().courCaches[key];
    if (!force && existing?.last_refreshed_at && Date.now() - Date.parse(existing.last_refreshed_at) < courTtlMs) {
      return this.refreshResponse(existing, 0, 0);
    }
    const active = this.refreshPromises.get(key);
    if (active) { await active; return this.refreshResponse(this.store.read().courCaches[key]!, 0, 0); }
    const promise = this.performRefresh(resolved.year, resolved.cour_month);
    this.refreshPromises.set(key, promise);
    try { return await promise; } finally { this.refreshPromises.delete(key); }
  }

  async refreshLongRunning() {
    const resolved = this.currentCour();
    try {
      const source = await this.provider.fetchCour(resolved.year, resolved.cour_month);
      const items = source.filter(isLongRunningActive).map((item) => ({ ...item, cour_relation: "long_running" as const, cour_relation_label: "长期" }));
      const cache: DataCache = { cache_date: platformDateKey(), updated_at: nowIso(), items: items.map(clearMark) };
      await this.store.update((state) => { state.longRunningCache = cache; state.weeklyCache = null; state.todayCache = null; });
      return { refresh_status: items.length ? "success" : "empty", source_start: dateKey(new Date(Date.now() - 183 * 86400000)), source_end: platformDateKey(), fetched_count: source.length, retained_count: items.length, last_maintenance_at: cache.updated_at, message: items.length ? "长剧集缓存已更新" : "未发现仍在放送的长剧集" };
    } catch (error) {
      const cached = this.store.read().longRunningCache;
      if (cached) return { refresh_status: "failed", source_start: null, source_end: null, fetched_count: 0, retained_count: cached.items.length, last_maintenance_at: cached.updated_at, message: safeError(error) };
      throw error;
    }
  }

  async setMark(itemId: string, markType: AnimeMarkType | null) {
    const state = this.store.read();
    const exists = [...state.items, ...(state.weeklyCache?.items ?? []), ...(state.longRunningCache?.items ?? [])].some((item) => item.id === itemId);
    if (!exists) throw httpError(404, "未找到该番剧");
    await this.store.update((next) => {
      if (markType) next.marks[itemId] = markType; else delete next.marks[itemId];
      next.todayCache = null;
    });
    return { ok: true, mark_type: markType };
  }

  stats(year?: number, courMonth?: number) {
    const resolved = this.resolveCour(year, courMonth);
    const state = this.store.read();
    const items = this.itemsForCour(this.withMarks(state.items, state.marks), resolved.year, resolved.cour_month);
    const todayWeekday = platformWeekday();
    return {
      year: resolved.year, cour_month: resolved.cour_month, cour_label: courLabel(resolved.year, resolved.cour_month), total: items.length,
      watching: items.filter((item) => item.mark_type === "watching").length,
      ignored: items.filter((item) => item.mark_type === "ignored").length,
      airing: items.filter((item) => item.status === "airing").length,
      not_started: items.filter((item) => item.status === "not_started").length,
      finished: items.filter((item) => item.status === "finished").length,
      today_updated: items.filter((item) => item.weekday === todayWeekday).length,
    };
  }

  getSettings() { return structuredClone(this.store.read().settings); }

  async saveSettings(input: unknown) {
    const settings = validateSettings(input);
    await this.store.saveSettings(settings);
    this.provider.setProxyUrl(settings.proxy.enabled ? settings.proxy.url : "");
    return settings;
  }

  async testConnection(input?: unknown) {
    const settings = input ? validateSettings(input) : this.getSettings();
    const probe = new BangumiProvider(settings.proxy.enabled ? settings.proxy.url : "");
    const items = await probe.fetchWeekly();
    return { ok: true, total: items.length, message: `连接正常，已读取 ${items.length} 部放送数据` };
  }

  async testNotification(kind: "cour" | "watching", input?: unknown) {
    const settings = input ? validateSettings(input) : this.getSettings();
    const payload = kind === "cour" ? this.buildCourNotification(settings) : await this.buildWatchingNotification(settings);
    return this.sendNotification(payload.title, payload.body, payload.channels, `test-${kind}-${Date.now()}`, kind === "cour" ? "" : "/weekly");
  }

  async runDueNotifications() {
    const now = platformNow();
    const time = now.toTimeString().slice(0, 5);
    const settings = this.getSettings();
    if (settings.notifications.courRelease.enabled && time >= settings.notifications.courRelease.sendTime) {
      const rule = settings.notifications.courRelease;
      const offsetDays = rule.scheduleMode === "offset" ? rule.offsetDays : 0;
      for (const year of [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]) {
        for (const courMonth of [1, 4, 7, 10]) {
          const target = new Date(year, courMonth - 1, 1 - offsetDays);
          if (dateKeyLocal(target) === platformDateKey()) await this.sendScheduledCour(year, courMonth, settings);
        }
      }
    }
    if (settings.notifications.watchingUpdate.enabled && time >= settings.notifications.watchingUpdate.sendTime) {
      await this.sendScheduledWatching(settings);
    }
  }

  private async sendScheduledCour(year: number, courMonth: number, settings: AnimeSettings) {
    const historyKey = `cour-release:${year}:${courMonth}:default`;
    if (this.store.read().notificationHistory[historyKey]) return;
    const payload = this.buildCourNotification(settings, year, courMonth);
    if (payload.items.length < settings.notifications.courRelease.minimumCount) return;
    const result = await this.sendNotification(payload.title, payload.body, payload.channels, `${year}-${courMonth}`, "");
    if (!result.ok) return;
    await this.store.update((state) => { state.notificationHistory[historyKey] = { sent_at: nowIso(), notification_id: result.notification_id }; });
  }

  private async sendScheduledWatching(settings: AnimeSettings) {
    const payload = await this.buildWatchingNotification(settings);
    if (!payload.items.length) return;
    const date = platformDateKey();
    const groups = settings.notifications.watchingUpdate.deliveryMode === "single" ? payload.items.map((item) => [item]) : [payload.items];
    for (const items of groups) {
      const suffix = settings.notifications.watchingUpdate.deliveryMode === "single"
        ? items[0]!.id
        : createHash("sha256").update(items.map((item) => item.id).sort().join(",")).digest("hex").slice(0, 16);
      const historyKey = `watching-update:${date}:${suffix}`;
      if (this.store.read().notificationHistory[historyKey]) continue;
      const message = this.buildWatchingPayload(settings, payload.date, items);
      const result = await this.sendNotification(message.title, message.body, message.channels, date, "/weekly");
      if (result.ok) await this.store.update((state) => { state.notificationHistory[historyKey] = { sent_at: nowIso(), notification_id: result.notification_id }; });
    }
  }

  private async performRefresh(year: number, courMonth: number) {
    const key = this.courKey(year, courMonth);
    const range = courRange(year, courMonth);
    await this.store.update((state) => { state.courCaches[key] = { ...emptyCourCache(year, courMonth), candidate_start: dateKey(new Date(Date.UTC(year, courMonth - 7, 1))), candidate_end: range.end_date, refresh_status: "refreshing" }; });
    try {
      const fetched = await this.provider.fetchCour(year, courMonth);
      const normalized = fetched.map((item) => withCourRelation(item, year, courMonth));
      const included = normalized.filter((item) => item.cour_relation !== "unknown");
      const counts = relationCounts(included);
      const previousIds = new Set(this.store.read().items.map((item) => item.id));
      let inserted = 0; let updated = 0;
      await this.store.update((state) => {
        const map = new Map(state.items.map((item) => [item.id, item]));
        for (const item of included) { if (map.has(item.id)) updated += 1; else inserted += 1; map.set(item.id, clearMark(item)); }
        state.items = [...map.values()];
        state.courCaches[key] = {
          year, cour_month: courMonth, candidate_start: dateKey(new Date(Date.UTC(year, courMonth - 4, 1))), candidate_end: range.end_date,
          last_refreshed_at: nowIso(), refresh_status: included.length ? "success" : "empty", fetched_count: fetched.length,
          unique_count: new Set(fetched.map((item) => item.id)).size, included_count: included.length,
          new_this_cour_count: counts.new_this_cour, continuing_count: counts.continuing, long_running_count: counts.long_running,
          unknown_count: counts.unknown, skipped_count: fetched.length - included.length, error_message: "",
        };
        state.todayCache = null;
      });
      const cache = this.store.read().courCaches[key]!;
      return this.refreshResponse(cache, inserted, updated || [...previousIds].filter((id) => included.some((item) => item.id === id)).length);
    } catch (error) {
      await this.store.update((state) => { state.courCaches[key] = { ...(state.courCaches[key] ?? emptyCourCache(year, courMonth)), refresh_status: "failed", error_message: safeError(error) }; });
      throw error;
    }
  }

  private async weeklyItems(force: boolean) {
    const state = this.store.read();
    if (!force && state.weeklyCache && Date.now() - Date.parse(state.weeklyCache.updated_at) < weeklyTtlMs) return state.weeklyCache.items;
    if (this.weeklyPromise) return this.weeklyPromise;
    this.weeklyPromise = (async () => {
      const fetched = await this.provider.fetchWeekly();
      const latestState = this.store.read();
      const longRunning = latestState.longRunningCache?.items ?? [];
      const map = new Map([...fetched, ...longRunning].map((item) => [item.id, item]));
      const items = [...map.values()].map((item) => withCourRelation(item, currentCour(platformNow()).year, currentCour(platformNow()).cour_month));
      const cache: DataCache = { cache_date: platformDateKey(), updated_at: nowIso(), items: items.map(clearMark) };
      await this.store.update((next) => { next.weeklyCache = cache; next.todayCache = null; });
      return items;
    })();
    try { return await this.weeklyPromise; } finally { this.weeklyPromise = null; }
  }

  private weeklyResponse(items: AnimeItem[], updatedAt: string) {
    const days = Array.from({ length: 7 }, (_, index) => {
      const weekday = index + 1;
      const dayItems = items.filter((item) => item.weekday === weekday && item.mark_type !== "ignored")
        .sort((a, b) => (a.air_time || "99:99").localeCompare(b.air_time || "99:99") || displayTitle(a).localeCompare(displayTitle(b), "zh-CN"));
      return { weekday, label: weekdayLabels[weekday], items: dayItems.map(publicItem) };
    });
    return { source: "bangumi_calendar", updated_at: updatedAt, total: days.reduce((sum, day) => sum + day.items.length, 0), days };
  }

  private todayResponse(items: AnimeItem[], updatedAt: string, date: string) {
    const visible = items.filter((item) => item.mark_type !== "ignored").map(publicItem);
    return { source: "bangumi_calendar", date, updated_at: updatedAt, total: visible.length, items: visible };
  }

  private itemsForCour(items: AnimeItem[], year: number, month: number) { return items.map((item) => withCourRelation(item, year, month)).filter((item) => item.cour_relation !== "unknown"); }
  private withMarks(items: AnimeItem[], marks: Record<string, AnimeMarkType>) { return items.map((item) => ({ ...item, mark_type: marks[item.id] ?? null })); }
  private courKey(year: number, month: number) { return `${year}-${month}`; }
  private resolveCour(year?: number, month?: number) { const fallback = this.currentCour(); const resolved = { year: year ?? fallback.year, cour_month: month ?? fallback.cour_month }; validateCourMonth(resolved.cour_month); return resolved; }
  private cacheStatus(cache: CourCache | undefined, count: number): AnimeCacheStatus { if (!cache) return count ? "stale" : "empty"; if (cache.refresh_status === "refreshing") return "refreshing"; if (cache.refresh_status === "failed") return "failed"; if (!count) return "empty"; return cache.last_refreshed_at && Date.now() - Date.parse(cache.last_refreshed_at) < courTtlMs ? "fresh" : "stale"; }
  private refreshResponse(cache: CourCache, inserted: number, updated: number) { return { year: cache.year, cour_month: cache.cour_month, cour_label: courLabel(cache.year, cache.cour_month), cache_status: cache.refresh_status === "success" ? "fresh" : cache.refresh_status, candidate_start: cache.candidate_start, candidate_end: cache.candidate_end, fetched_count: cache.fetched_count, unique_count: cache.unique_count, included_count: cache.included_count, new_this_cour_count: cache.new_this_cour_count, continuing_count: cache.continuing_count, long_running_count: cache.long_running_count, unknown_count: cache.unknown_count, skipped_count: cache.skipped_count, last_refreshed_at: cache.last_refreshed_at, inserted, updated, total: cache.included_count }; }

  private buildCourNotification(settings: AnimeSettings, year?: number, courMonth?: number) {
    const resolved = year && courMonth ? { year, cour_month: courMonth } : this.currentCour(); const rule = settings.notifications.courRelease;
    const state = this.store.read();
    const items = this.itemsForCour(this.withMarks(state.items, state.marks), resolved.year, resolved.cour_month).filter((item) => notificationMatches(item, rule) && (rule.minScore === null || (item.score !== null && item.score >= rule.minScore)));
    const values = { year: resolved.year, cour_month: resolved.cour_month, cour_label: courLabel(resolved.year, resolved.cour_month), total_count: items.length, new_count: items.filter((item) => item.cour_relation === "new_this_cour").length, continuing_count: items.filter((item) => item.cour_relation === "continuing").length, region: regionText(rule.regions), anime_list: animeList(items), refresh_time: nowIso(), module_url: `/modules/${this.moduleId}` };
    return { title: renderTemplate(rule.titleTemplate, values), body: renderTemplate(rule.bodyTemplate, values), channels: rule.channels, items };
  }

  private async buildWatchingNotification(settings: AnimeSettings) {
    const rule = settings.notifications.watchingUpdate; const response = await this.today();
    const items = response.items.filter((item) => item.mark_type === "watching" && notificationMatches(item as AnimeItem, rule));
    return { ...this.buildWatchingPayload(settings, response.date, items as AnimeItem[]), items: items as AnimeItem[], date: response.date };
  }

  private buildWatchingPayload(settings: AnimeSettings, date: string, items: AnimeItem[]) {
    const rule = settings.notifications.watchingUpdate; const first = items[0];
    const values = { date, weekday: weekdayLabels[platformWeekday()], count: items.length, anime_list: animeList(items), region: regionText(rule.regions), module_url: `/modules/${this.moduleId}/weekly`, anime_title: first ? displayTitle(first) : "", anime_title_original: first?.title_original ?? "", score: first?.score ?? "", media_type: first?.media_type ?? "", cour_relation: first?.cour_relation_label ?? "", bangumi_url: first?.external_url ?? "" };
    return { title: renderTemplate(rule.titleTemplate, values), body: renderTemplate(rule.bodyTemplate, values), channels: rule.channels };
  }

  private async sendNotification(title: string, content: string, channels: string[], sourceId: string, suffix: string) {
    if (!this.platformApiUrl || !this.platformToken) return { ok: false, notification_id: null, message: "平台通知服务未配置", deliveries: [] };
    try {
      const requestBody: Record<string, unknown> = { title, summary: title, content, level: "info", event_type: `anime_calendar.${sourceId.startsWith("test") ? "test" : sourceId}`, source_type: "anime_calendar", source_id: sourceId, related_url: `/modules/${this.moduleId}${suffix}` };
      if (!channels.includes("default")) requestBody.channels = channels;
      const response = await fetch(`${this.platformApiUrl}/internal/modules/${encodeURIComponent(this.moduleId)}/notifications`, { method: "POST", headers: { "content-type": "application/json", "x-toolnest-internal-token": this.platformToken }, body: JSON.stringify(requestBody), signal: AbortSignal.timeout(10_000) });
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) return { ok: false, notification_id: null, message: typeof payload.message === "string" ? payload.message : "平台通知发送失败", deliveries: [] };
      const id = typeof payload.id === "string" ? payload.id : typeof payload.notification_id === "string" ? payload.notification_id : null;
      const deliveries = Array.isArray(payload.deliveries) ? payload.deliveries : [];
      return { ok: true, notification_id: id, message: "测试通知已发送", deliveries };
    } catch { return { ok: false, notification_id: null, message: "无法连接平台通知服务", deliveries: [] }; }
  }
}

function publicItem(item: AnimeItem): AnimeListItem { const { title_romaji: _a, estimated_end_date: _b, air_month: _c, summary: _d, tags: _e, raw: _f, created_at: _g, updated_at: _h, ...rest } = item; return rest; }
function clearMark(item: AnimeItem): AnimeItem { return { ...item, mark_type: null }; }
function mergeDetail(base: AnimeItem, detail: AnimeItem, mark: AnimeMarkType | null): AnimeItem { return { ...base, ...detail, id: base.id, provider_id: base.provider_id, year: base.year, cour_month: base.cour_month, cour_label: base.cour_label, cour_relation: base.cour_relation, cour_relation_label: base.cour_relation_label, weekday: base.weekday, air_time: base.air_time, mark_type: mark }; }
function displayTitle(item: AnimeItem) { return item.title_cn || item.title_original; }
function cacheMessage(status: AnimeCacheStatus, error: string) { if (status === "fresh") return "缓存已是最新"; if (status === "stale") return "正在使用可能过期的缓存"; if (status === "refreshing") return "正在刷新档期数据"; if (status === "failed") return error || "刷新失败，已保留现有数据"; return "当前档期暂无缓存"; }
function emptyCourCache(year: number, month: number): CourCache { return { year, cour_month: month, candidate_start: null, candidate_end: null, last_refreshed_at: null, refresh_status: "empty", fetched_count: 0, unique_count: 0, included_count: 0, new_this_cour_count: 0, continuing_count: 0, long_running_count: 0, unknown_count: 0, skipped_count: 0, error_message: "" }; }
function withCourRelation(item: AnimeItem, year: number, month: number): AnimeItem { const range = courRange(year, month); const start = item.air_date ? new Date(`${item.air_date}T00:00:00Z`) : null; const end = item.estimated_end_date ? new Date(`${item.estimated_end_date}T00:00:00Z`) : null; let relation: AnimeItem["cour_relation"] = "unknown"; if (start && start >= range.start && start <= range.end) relation = "new_this_cour"; else if (start && start < range.start && (!end || end >= range.start)) relation = differenceDays(range.start, start) >= 183 ? "long_running" : "continuing"; return { ...item, year, cour_month: month, cour_label: courLabel(year, month), cour_relation: relation, cour_relation_label: relation === "new_this_cour" ? "新番" : relation === "continuing" ? "续播" : relation === "long_running" ? "长期" : "未定" }; }
function isLongRunningActive(item: AnimeItem) { if (!item.air_date) return false; const start = new Date(`${item.air_date}T00:00:00Z`); const end = item.estimated_end_date ? new Date(`${item.estimated_end_date}T00:00:00Z`) : null; return differenceDays(platformNow(), start) >= 150 && (!end || end >= platformNow()); }
function relationCounts(items: AnimeItem[]) { return { new_this_cour: items.filter((item) => item.cour_relation === "new_this_cour").length, continuing: items.filter((item) => item.cour_relation === "continuing").length, long_running: items.filter((item) => item.cour_relation === "long_running").length, unknown: items.filter((item) => item.cour_relation === "unknown").length }; }
function differenceDays(a: Date, b: Date) { return Math.floor((a.getTime() - b.getTime()) / 86400000); }
function platformNow() { return new Date(); }
function platformDateKey() { return new Intl.DateTimeFormat("en-CA", { timeZone: process.env.TOOLNEST_TIMEZONE || "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(platformNow()); }
function platformWeekday() { const name = new Intl.DateTimeFormat("en-US", { timeZone: process.env.TOOLNEST_TIMEZONE || "Asia/Shanghai", weekday: "short" }).format(platformNow()); return ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 } as Record<string, number>)[name] ?? 0; }
function dateKeyLocal(value: Date) { return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`; }
function nowIso() { return new Date().toISOString(); }
function safeError(error: unknown) { return error instanceof Error ? error.message.replace(/[A-Za-z]:\\[^\s]+/g, "本地路径") : "操作失败"; }
export function httpError(statusCode: number, message: string) { return Object.assign(new Error(message), { statusCode }); }

export function validateSettings(input: unknown): AnimeSettings {
  if (!input || typeof input !== "object") throw httpError(422, "设置格式不正确");
  const settings = mergeSettings(input as Partial<AnimeSettings>);
  if (!["cour", "weekly"].includes(settings.defaultPage) || !["grid", "list"].includes(settings.defaultView) || !["default", "score"].includes(settings.defaultSort)) throw httpError(422, "展示偏好包含不支持的选项");
  if (![12, 24, 168].includes(settings.refreshIntervalHours) || ![0, 30, 90].includes(settings.cacheRetentionDays)) throw httpError(422, "缓存周期包含不支持的选项");
  if (settings.proxy.enabled) { try { const url = new URL(settings.proxy.url.trim()); if (!["http:", "https:", "socks5:", "socks5h:"].includes(url.protocol)) throw new Error(); } catch { throw httpError(422, "代理地址必须是有效的 http、https、socks5 或 socks5h URL"); } }
  const allowedChannels = new Set(["default", "web_internal", "qqbot", "email"]); const allowedRegions = new Set(["all", "jp", "cn", "western", "kr", "other", "unknown"]);
  if (!allowedRegions.has(settings.defaultRegion) || !allowedRegions.has(settings.weeklyRegion)) throw httpError(422, "默认地区包含不支持的选项");
  for (const rule of [settings.notifications.courRelease, settings.notifications.watchingUpdate]) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(rule.sendTime)) throw httpError(422, "发送时间必须使用 HH:mm 格式"); if (typeof rule.titleTemplate !== "string" || typeof rule.bodyTemplate !== "string" || rule.titleTemplate.length > 4000 || rule.bodyTemplate.length > 4000) throw httpError(422, "通知模板不能超过 4000 个字符"); if (!Array.isArray(rule.channels) || rule.channels.length === 0 || rule.channels.some((channel) => !allowedChannels.has(channel)) || (rule.channels.includes("default") && rule.channels.length > 1)) throw httpError(422, "通知渠道包含不支持的选项"); if (!Array.isArray(rule.regions) || rule.regions.some((region) => !allowedRegions.has(region))) throw httpError(422, "通知地区包含不支持的选项"); }
  if (settings.notifications.courRelease.offsetDays < -30 || settings.notifications.courRelease.offsetDays > 30) throw httpError(422, "提前天数必须在 -30 到 30 之间");
  if (!["cour_first_day", "offset"].includes(settings.notifications.courRelease.scheduleMode)) throw httpError(422, "季度通知日期模式不受支持");
  if (settings.notifications.courRelease.minScore !== null && (settings.notifications.courRelease.minScore < 0 || settings.notifications.courRelease.minScore > 10)) throw httpError(422, "最低评分必须在 0 到 10 之间");
  if (!Number.isInteger(settings.notifications.courRelease.minimumCount) || settings.notifications.courRelease.minimumCount < 0 || settings.notifications.courRelease.minimumCount > 999) throw httpError(422, "最少番剧数必须在 0 到 999 之间");
  if (!["digest", "single"].includes(settings.notifications.watchingUpdate.deliveryMode)) throw httpError(422, "关注通知发送模式不受支持");
  validateTemplate(settings.notifications.courRelease.titleTemplate + settings.notifications.courRelease.bodyTemplate, new Set(["year", "cour_month", "cour_label", "total_count", "new_count", "continuing_count", "region", "anime_list", "refresh_time", "module_url"]));
  validateTemplate(settings.notifications.watchingUpdate.titleTemplate + settings.notifications.watchingUpdate.bodyTemplate, new Set(["date", "weekday", "count", "anime_list", "region", "module_url", "anime_title", "anime_title_original", "score", "media_type", "cour_relation", "bangumi_url"]));
  return settings;
}
function validateTemplate(template: string, allowed: Set<string>) { for (const match of template.matchAll(/\{([^{}]+)\}/g)) if (!allowed.has(match[1] ?? "")) throw httpError(422, `未知模板变量：{${match[1]}}`); }
function renderTemplate(template: string, values: Record<string, unknown>) { return template.replace(/\{([^{}]+)\}/g, (_match, key: string) => String(values[key] ?? "")); }
function notificationMatches(item: AnimeItem, rule: NotificationRuleBase) { if (!rule.includeContinuing && item.cour_relation === "continuing") return false; return rule.regions.includes("all") || rule.regions.includes(item.region); }
function animeList(items: AnimeItem[]) { return items.slice(0, 20).map((item) => `- ${displayTitle(item)}${item.air_time ? `（${item.air_time}）` : ""}`).join("\n") || "暂无匹配作品"; }
function regionText(regions: string[]) { return regions.includes("all") ? "全部地区" : regions.join("、"); }
