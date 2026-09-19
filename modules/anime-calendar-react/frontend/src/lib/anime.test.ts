import { describe, expect, it } from "vitest";
import { filterItems, nextCour, weekState } from "./anime";
import type { AnimeListItem } from "@/types";

const base: AnimeListItem = { id: "1", provider: "bangumi", provider_id: "1", title_cn: "测试新番", title_original: "Test Anime", cover_url: "", studio: "测试社", year: 2026, cour_month: 7, cour_label: "2026年7月新番", air_date: "2026-07-03", cour_relation: "new_this_cour", cour_relation_label: "新番", air_time: "23:00", weekday: 5, status: "airing", media_type: "tv", episode_count: 12, current_episode: 1, score: 8, external_url: "", region: "jp", mark_type: null };
const options = { keyword: "", weekday: null, status: null, mediaType: null, markType: null, region: "all", showContinuing: true, showUnknown: true, sort: "default" as const };

describe("anime view helpers", () => {
  it("handles cross-year cour navigation", () => { expect(nextCour(2026, 10, 1)).toEqual({ year: 2027, month: 1 }); expect(nextCour(2026, 1, -1)).toEqual({ year: 2025, month: 10 }); });
  it("filters hidden items and sorts watched records first", () => {
    const watched = { ...base, id: "2", title_cn: "关注作品", mark_type: "watching" as const, score: 6 };
    const ignored = { ...base, id: "3", mark_type: "ignored" as const };
    expect(filterItems([base, watched, ignored], options).map((item) => item.id)).toEqual(["2", "1"]);
    expect(filterItems([base, watched], { ...options, keyword: "关注" })).toEqual([watched]);
  });
  it("labels weekday states", () => { expect(weekState(3, 3)).toBe("today"); expect(weekState(2, 3)).toBe("past"); expect(weekState(4, 3)).toBe("upcoming"); });
});
