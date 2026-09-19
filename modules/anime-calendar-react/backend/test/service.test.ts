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
    expect(service.listItems({ year: 2026, cour_month: 7, include_ignored: true }).items).toHaveLength(1);
    await service.setMark("bangumi:1", "watching");
    expect(service.listItems({ year: 2026, cour_month: 7 }).items[0]?.mark_type).toBe("watching");
    expect(store.snapshot().items[0]?.mark_type).toBeNull();
    const detail = await service.getItem("bangumi:1");
    expect(detail).toMatchObject({ summary: "完整简介", year: 2026, cour_month: 7, cour_label: "2026年7月新番", weekday: 5, air_time: "23:00" });
    await store.update((state) => { state.detailCache["bangumi:1"]!.item = { ...state.detailCache["bangumi:1"]!.item, year: 2026, cour_month: 4, cour_label: "2026年4月新番" }; });
    expect(await service.getItem("bangumi:1")).toMatchObject({ cour_month: 7, cour_label: "2026年7月新番" });
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
});

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
      expect(received).toMatchObject({ event_type: "anime_calendar.test", source_type: "anime_calendar" });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
