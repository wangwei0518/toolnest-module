import { describe, expect, it } from "vitest";

import { pruneAnimeCaches } from "../src/postgres-store.js";
import { defaultSettings, type StoreState } from "../src/types.js";

describe("anime cache retention", () => {
  it("bounds detail, notification, and cour cache collections", () => {
    const recent = new Date().toISOString();
    const state: StoreState = {
      items: [],
      marks: {},
      courCaches: Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`2020-${index}`, { year: 2020 + Math.floor(index / 4), cour_month: (index % 4) * 3 + 1, candidate_start: null, candidate_end: null, last_refreshed_at: recent, refresh_status: "success", fetched_count: 0, unique_count: 0, included_count: 0, new_this_cour_count: 0, continuing_count: 0, long_running_count: 0, unknown_count: 0, skipped_count: 0, error_message: "" }])),
      weeklyCache: null,
      todayCache: null,
      longRunningCache: null,
      detailCache: Object.fromEntries(Array.from({ length: 550 }, (_, index) => [`detail-${index}`, { cached_at: recent, item: {} as never }])),
      settings: structuredClone(defaultSettings),
      notificationHistory: Object.fromEntries(Array.from({ length: 2_050 }, (_, index) => [`history-${index}`, { sent_at: recent, notification_id: null }])),
    };

    pruneAnimeCaches(state);

    expect(Object.keys(state.courCaches)).toHaveLength(24);
    expect(Object.keys(state.detailCache)).toHaveLength(500);
    expect(Object.keys(state.notificationHistory)).toHaveLength(2_000);
  });
});
