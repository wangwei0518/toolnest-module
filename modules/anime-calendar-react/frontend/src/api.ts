import { getModuleApiClient } from "./api/client";
import type { AnimeDetail, AnimeMarkType, AnimeSettings, ItemsResponse, NotificationTestResponse, RefreshResponse, TodayResponse, WeeklyResponse } from "./types";

const api = () => getModuleApiClient();
const endpoint = (path: string) => `/modules/anime-calendar-react${path}`;
export const animeApi = {
  currentCour: () => api().get<{ year: number; cour_month: number }>(endpoint("/cour/current")),
  items: (params: Record<string, unknown>) => api().get<ItemsResponse>(endpoint("/items"), { params }),
  detail: (id: string) => api().get<AnimeDetail>(endpoint(`/items/${encodeURIComponent(id)}`)),
  weekly: (force = false) => api().get<WeeklyResponse>(endpoint("/weekly"), { params: { force }, timeout: 120_000 }),
  today: () => api().get<TodayResponse>(endpoint("/today"), { timeout: 120_000 }),
  refresh: (year: number, courMonth: number) => api().post<RefreshResponse>(endpoint("/refresh"), { year, cour_month: courMonth, force: true }, { timeout: 120_000 }),
  refreshLongRunning: () => api().post<{ retained_count: number; message: string }>(endpoint("/long-running/refresh"), {}, { timeout: 120_000 }),
  mark: (id: string, markType: AnimeMarkType) => api().post<{ ok: boolean; mark_type: AnimeMarkType }>(endpoint(`/items/${encodeURIComponent(id)}/mark`), { mark_type: markType }),
  unmark: (id: string) => api().delete<{ ok: boolean; mark_type: null }>(endpoint(`/items/${encodeURIComponent(id)}/mark`)),
  settings: () => api().get<AnimeSettings>(endpoint("/calendar-settings")),
  saveSettings: (settings: AnimeSettings) => api().put<AnimeSettings>(endpoint("/calendar-settings"), settings),
  testConnection: (settings: AnimeSettings) => api().post<{ ok: boolean; total: number; message: string }>(endpoint("/connection-test"), { settings }, { timeout: 120_000 }),
  testNotification: (kind: "cour" | "watching", settings: AnimeSettings) => api().post<NotificationTestResponse>(endpoint(`/notifications/test-${kind === "cour" ? "cour-release" : "watching-update"}`), { settings }),
};
