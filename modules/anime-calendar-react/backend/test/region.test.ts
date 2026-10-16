import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inferRegion } from "../src/region.js";
import { JsonStore } from "../src/store.js";
import { defaultSettings, type AnimeItem, type StoreState } from "../src/types.js";

describe("production region", () => {
  it("does not classify the Apothecary Diaries Chinese setting as Chinese production", () => {
    expect(inferRegion({ name: "薬屋のひとりごと 第3期", name_cn: "药屋少女的呢喃 第三季", platform: "TV" }, ["日本", "中国风", "中华风", "国风", "OLM"], "OLM Division 2")).toBe("jp");
  });

  it.each(["中国风", "中华风", "国风", "韩漫", "中国神话", "日本舞台"])("does not use %s as a production country", tag => {
    expect(inferRegion({}, [tag], "")).toBe("unknown");
  });

  it.each(["bilibili", "腾讯", "爱奇艺", "Netflix"])("does not use distributor %s as a production country", platform => {
    expect(inferRegion({ platform, name: "中国风故事" }, ["日本"], "")).toBe("jp");
    expect(inferRegion({ platform }, [], "")).toBe("unknown");
  });

  it.each([["国产动画", "cn"], ["日本动画", "jp"], ["韩国", "kr"], ["美国", "western"]])("recognizes explicit origin tag %s", (tag, expected) => {
    expect(inferRegion({}, [tag], "")).toBe(expected);
  });

  it("prefers an explicit origin field and preserves unknown for multiple origins", () => {
    expect(inferRegion({ infobox: [{ key: "制作地区", value: "日本" }] }, ["国产"], "")).toBe("jp");
    expect(inferRegion({ country: ["日本", "中国"] }, ["日本"], "OLM")).toBe("unknown");
    expect(inferRegion({}, ["日本", "中国"], "")).toBe("unknown");
  });

  it("can identify the production studio when region tags are absent", () => {
    expect(inferRegion({}, ["中国风"], "OLM Division 2")).toBe("jp");
    expect(inferRegion({}, [], "TOHO animation STUDIO")).toBe("jp");
  });

  it("repairs saved catalog/detail/weekly/today/long-running caches without changing marks or refresh dates", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "anime-region-"));
    const cachedAt = new Date().toISOString();
    const item = {
      id: "bangumi:568244", provider: "bangumi", provider_id: "568244",
      title_cn: "药屋少女的呢喃 第三季", title_original: "薬屋のひとりごと 第3期",
      region: "cn", tags: ["日本", "中国风"], studio: "OLM Division 2",
      raw: { id: 568244, name: "薬屋のひとりごと 第3期" }, mark_type: null,
    } as AnimeItem;
    const weekly = { ...item, raw: { id: 568244 }, tags: [], studio: "" };
    const state = {
      items: [item], marks: { [item.id]: "watching" }, courCaches: {},
      detailCache: { [item.id]: { cached_at: cachedAt, item } },
      weeklyCache: { updated_at: cachedAt, cache_date: "2026-10-13", items: [weekly] },
      todayCache: { updated_at: cachedAt, cache_date: "2026-10-13", items: [weekly] },
      longRunningCache: { updated_at: cachedAt, cache_date: "2026-10-13", items: [item] },
      settings: structuredClone(defaultSettings), notificationHistory: {},
    } as StoreState;
    try {
      await writeFile(path.join(directory, "anime-calendar-state.json"), JSON.stringify(state));
      const store = new JsonStore(directory);
      await store.init();
      const saved = store.read();
      expect([saved.items[0]?.region, saved.detailCache[item.id]?.item.region, saved.weeklyCache?.items[0]?.region, saved.todayCache?.items[0]?.region, saved.longRunningCache?.items[0]?.region]).toEqual(["jp", "jp", "jp", "jp", "jp"]);
      expect(saved.marks).toEqual(state.marks);
      expect(saved.weeklyCache?.updated_at).toBe(cachedAt);
      expect(saved.detailCache[item.id]?.cached_at).toBe(cachedAt);
      await store.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
