import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { currentCour, courRange } from "../src/cour.js";
import { AnimeCalendarService, validateSettings } from "../src/service.js";
import { JsonStore } from "../src/store.js";
import { defaultSettings, type AnimeItem } from "../src/types.js";
import type { BangumiProvider } from "../src/provider.js";

let directory = "";
let store: JsonStore;

const item = (overrides: Partial<AnimeItem> = {}): AnimeItem => ({
  id: "bangumi:1", provider: "bangumi", provider_id: "1", title_cn: "测试新番", title_original: "Test Anime", title_romaji: "", cover_url: "", studio: "测试动画",
  year: 2026, cour_month: 7, cour_label: "2026年7月新番", air_date: "2026-07-03", estimated_end_date: "2026-09-25", cour_relation: "unknown", cour_relation_label: "未定", air_time: "23:00", air_month: "2026-07", weekday: 5, status: "airing", media_type: "tv", episode_count: 12, current_episode: 1, score: 8.2, summary: "简介", tags: ["日本"], external_url: "https://bgm.tv/subject/1", region: "jp", raw: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), mark_type: null, ...overrides,
});

beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), "anime-calendar-react-")); store = new JsonStore(directory); await store.init(); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("cour helpers", () => {
  it("resolves quarter boundaries and cross-year dates", () => {
    expect(currentCour(new Date("2026-01-15T00:00:00Z"))).toEqual({ year: 2026, cour_month: 1 });
    expect(currentCour(new Date("2026-11-15T00:00:00Z"))).toEqual({ year: 2026, cour_month: 10 });
    expect(courRange(2024, 1)).toMatchObject({ start_date: "2024-01-01", end_date: "2024-03-31" });
  });
});

describe("service cache and marks", () => {
  it("refreshes a cour, persists records and keeps marks separate", async () => {
    const provider = { setProxyUrl() {}, fetchCour: async () => [item()], fetchWeekly: async () => [item()], fetchDetail: async () => item({ summary: "完整简介" }) } as unknown as BangumiProvider;
    const service = new AnimeCalendarService(store, provider, "anime-calendar-react", "", "token");
    const refreshed = await service.refresh(2026, 7, true);
    expect(refreshed.total).toBe(1);
    expect((await service.listItems({ year: 2026, cour_month: 7, include_ignored: true })).items).toHaveLength(1);
    await service.setMark("bangumi:1", "watching");
    expect((await service.listItems({ year: 2026, cour_month: 7 })).items[0]?.mark_type).toBe("watching");
    expect(store.snapshot().items[0]?.mark_type).toBeNull();
    const detail = await service.getItem("bangumi:1");
    expect(detail).toMatchObject({ summary: "完整简介", year: 2026, cour_month: 7, cour_label: "2026年7月新番", weekday: 5, air_time: "23:00" });
    await store.update((state) => { state.detailCache["bangumi:1"]!.item = { ...state.detailCache["bangumi:1"]!.item, year: 2026, cour_month: 4, cour_label: "2026年4月新番" }; });
    expect(await service.getItem("bangumi:1")).toMatchObject({ cour_month: 7, cour_label: "2026年7月新番" });
  });

  it("excludes one-episode non-movies but keeps one-episode movies", async () => {
    const shortOna = item({ id: "bangumi:short", provider_id: "short", title_cn: "单集短片", media_type: "ona", episode_count: 1 });
    const movie = item({ id: "bangumi:movie", provider_id: "movie", title_cn: "剧场版", media_type: "movie", episode_count: 1 });
    const titleClassifiedMovie = item({ id: "bangumi:title-movie", provider_id: "title-movie", title_cn: "某作品剧场版", media_type: "ona", episode_count: 1 });
    const provider = { setProxyUrl() {}, fetchCour: async () => [shortOna, movie, titleClassifiedMovie], fetchWeekly: async () => [], fetchDetail: async () => movie } as unknown as BangumiProvider;
    const service = new AnimeCalendarService(store, provider, "anime-calendar-react", "", "token");

    const refreshed = await service.refresh(2026, 7, true);

    expect(refreshed.total).toBe(2);
    expect((await service.listItems({ year: 2026, cour_month: 7, include_ignored: true })).items.map((entry) => entry.id)).toEqual(["bangumi:movie", "bangumi:title-movie"]);
    expect(store.snapshot().courCaches["2026-7"]).toMatchObject({ fetched_count: 3, included_count: 2, skipped_count: 1 });
  });

  it("does not carry a completed previous-cour series into the current cour", async () => {
    const completed = item({ id: "bangumi:completed", provider_id: "completed", air_date: "2026-04-03", estimated_end_date: "2026-07-03", episode_count: 12 });
    const staleHalfYear = item({ id: "bangumi:stale-half-year", provider_id: "stale-half-year", air_date: "2023-02-07", episode_count: 34, status: "finished" });
    const provider = { setProxyUrl() {}, fetchCour: async () => [completed, staleHalfYear], fetchWeekly: async () => [], fetchDetail: async () => completed } as unknown as BangumiProvider;
    const service = new AnimeCalendarService(store, provider, "anime-calendar-react", "", "token");

    const refreshed = await service.refresh(2026, 7, true);
    const items = (await service.listItems({ year: 2026, cour_month: 7, include_ignored: true })).items;

    expect(refreshed.total).toBe(0);
    expect(items).toHaveLength(0);
    expect(items.find((entry) => entry.id === "bangumi:stale-half-year")).toBeUndefined();
  });

  it("classifies cross-cour shows by 12-episode spans instead of estimated end dates", async () => {
    const singleCour = item({ id: "bangumi:single-cour", provider_id: "single-cour", air_date: "2026-04-03", estimated_end_date: "2026-04-10", episode_count: 23 });
    const halfYear = item({ id: "bangumi:half-year", provider_id: "half-year", air_date: "2026-04-03", estimated_end_date: "2026-04-10", episode_count: 24 });
    const longRunning = item({ id: "bangumi:long-running", provider_id: "long-running", air_date: "2026-04-03", estimated_end_date: "2026-04-10", episode_count: 36 });
    const provider = { setProxyUrl() {}, fetchCour: async () => [singleCour, halfYear, longRunning], fetchWeekly: async () => [], fetchDetail: async () => halfYear } as unknown as BangumiProvider;
    const service = new AnimeCalendarService(store, provider, "anime-calendar-react", "", "token");

    const refreshed = await service.refresh(2026, 7, true);
    const items = (await service.listItems({ year: 2026, cour_month: 7, include_ignored: true })).items;

    expect(refreshed).toMatchObject({ total: 2, continuing_count: 1, long_running_count: 1 });
    expect(items.find((entry) => entry.id === "bangumi:single-cour")).toBeUndefined();
    expect(items.find((entry) => entry.id === "bangumi:half-year")?.cour_relation).toBe("continuing");
    expect(items.find((entry) => entry.id === "bangumi:long-running")?.cour_relation).toBe("long_running");
  });

  it("coalesces concurrent weekly requests and derives the today cache", async () => {
    let calls = 0;
    const weekday = new Date().getDay() || 7;
    const provider = { setProxyUrl() {}, fetchCour: async () => [], fetchWeekly: async () => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 10)); return [item({ weekday, air_date: new Date().toISOString().slice(0, 10) })]; }, fetchDetail: async () => item() } as unknown as BangumiProvider;
    const service = new AnimeCalendarService(store, provider, "anime-calendar-react", "", "token");
    await Promise.all([service.weekly(), service.weekly()]);
    expect(calls).toBe(1);
    const today = await service.today();
    expect(today.items).toHaveLength(1);
    expect(store.snapshot().todayCache).not.toBeNull();
  });

  it("includes weekly-only long-running titles in the cour catalog", async () => {
    const weeklyOnly = item({ id: "bangumi:one-piece", provider_id: "one-piece", title_cn: "航海王", title_original: "ONE PIECE", air_date: "1999-10-20", estimated_end_date: null, episode_count: null, status: "airing" });
    const provider = { setProxyUrl() {}, fetchCour: async () => [], fetchWeekly: async () => [weeklyOnly], fetchDetail: async () => weeklyOnly } as unknown as BangumiProvider;
    const service = new AnimeCalendarService(store, provider, "anime-calendar-react", "", "token");
    const current = service.currentCour();

    const result = await service.listItems({ year: current.year, cour_month: current.cour_month, include_ignored: true });

    expect(result.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: "bangumi:one-piece", title_cn: "航海王", cour_relation: "long_running" })]));
  });

  it("reuses catalog regions for an already cached weekly response", async () => {
    const weeklyItem = item({ id: "bangumi:weekly", provider_id: "weekly", region: "unknown" });
    const catalogItem = item({ id: "bangumi:weekly", provider_id: "weekly", region: "jp", tags: ["日本"] });
    await store.update((state) => {
      state.items = [catalogItem];
      state.weeklyCache = { cache_date: "2026-09-22", updated_at: new Date(Date.now() + 60_000).toISOString(), items: [clearMarkForTest(weeklyItem)] };
    });
    const provider = { setProxyUrl() {}, fetchCour: async () => [], fetchWeekly: async () => { throw new Error("不应重新请求周历"); }, fetchDetail: async () => catalogItem } as unknown as BangumiProvider;
    const service = new AnimeCalendarService(store, provider, "anime-calendar-react", "", "token");

    const response = await service.weekly();

    expect(response.days.flatMap((day) => day.items)).toMatchObject([{ id: "bangumi:weekly", region: "jp" }]);
  });
});

function clearMarkForTest(value: AnimeItem): AnimeItem { return { ...value, mark_type: null }; }

describe("settings validation", () => {
  it("rejects unsafe proxy schemes and unknown template variables", () => {
    expect(() => validateSettings({ ...defaultSettings, proxy: { enabled: true, url: "file:///tmp/proxy" } })).toThrow(/代理地址/);
    expect(() => validateSettings({ ...defaultSettings, notifications: { ...defaultSettings.notifications, courRelease: { ...defaultSettings.notifications.courRelease, titleTemplate: "{unknown}" } } })).toThrow(/未知模板变量/);
    expect(() => validateSettings({ ...defaultSettings, notifications: { ...defaultSettings.notifications, courRelease: { ...defaultSettings.notifications.courRelease, minScore: 11 } } })).toThrow(/最低评分/);
    expect(() => validateSettings({ ...defaultSettings, notifications: { ...defaultSettings.notifications, watchingUpdate: { ...defaultSettings.notifications.watchingUpdate, channels: ["unsupported"] } } })).toThrow(/通知渠道/);
    expect(() => validateSettings({ ...defaultSettings, notifications: { ...defaultSettings.notifications, watchingUpdate: { ...defaultSettings.notifications.watchingUpdate, channels: ["default", "email"] } } })).toThrow(/通知渠道/);
  });
});

describe("platform notifications", () => {
  it("omits channels when the platform default channel is selected", async () => {
    let received: Record<string, unknown> = {};
    const server = createServer((request, response) => {
      if (request.method === "GET" && request.url?.endsWith("/public-url")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ data: { public_base_url: "https://toolnest.example.com/" } }));
        return;
      }
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        received = JSON.parse(body) as Record<string, unknown>;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ notification_id: "notification-1", deliveries: [{ channel: "web_internal", status: "sent" }] }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("test server did not bind a TCP port");
      const provider = { setProxyUrl() {}, fetchCour: async () => [], fetchWeekly: async () => [], fetchDetail: async () => item() } as unknown as BangumiProvider;
      const service = new AnimeCalendarService(store, provider, "anime-calendar-react", `http://127.0.0.1:${address.port}/api/v1`, "token");
      const result = await service.testNotification("cour", defaultSettings);
      expect(result).toMatchObject({ ok: true, notification_id: "notification-1" });
      expect(received.channels).toBeUndefined();
      expect(received).toMatchObject({ event_type: "anime_calendar.test", source_type: "anime_calendar", summary: "" });
      expect(received.content).toContain("https://toolnest.example.com/modules/anime-calendar-react");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
