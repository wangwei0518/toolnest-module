import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { animeApi } from "@/api";
import { notify } from "@/module-context";
import type { AnimeListItem, AnimeMarkType, AnimeSettings } from "@/types";

export const calendarKeys = { items: (year: number, month: number) => ["anime-calendar", "items", year, month] as const, today: ["anime-calendar", "today"] as const, weekly: ["anime-calendar", "weekly"] as const, settings: ["anime-calendar", "settings"] as const, detail: (id: string) => ["anime-calendar", "detail", id] as const };

export function useCourItems(year: number, month: number) { return useQuery({ queryKey: calendarKeys.items(year, month), queryFn: () => animeApi.items({ year, cour_month: month, include_ignored: true }) }); }
export function useToday() { return useQuery({ queryKey: calendarKeys.today, queryFn: animeApi.today }); }
export function useWeekly() { return useQuery({ queryKey: calendarKeys.weekly, queryFn: () => animeApi.weekly(false) }); }
export function useDetail(id: string | null) { return useQuery({ queryKey: calendarKeys.detail(id ?? ""), queryFn: () => animeApi.detail(id!), enabled: Boolean(id) }); }
export function useSettings() { return useQuery({ queryKey: calendarKeys.settings, queryFn: animeApi.settings }); }

export function useMarkMutation() {
  const client = useQueryClient();
  return useMutation<{ ok: boolean; mark_type: AnimeMarkType | null }, Error, { item: AnimeListItem; mark: AnimeMarkType }, { previous: Array<[readonly unknown[], unknown]>; next: AnimeMarkType | null }>({
    mutationFn: async ({ item, mark }) => item.mark_type === mark ? animeApi.unmark(item.id) : animeApi.mark(item.id, mark),
    onMutate: async ({ item, mark }) => {
      await client.cancelQueries({ queryKey: ["anime-calendar"] });
      const previous = client.getQueriesData({ queryKey: ["anime-calendar"] });
      const next = item.mark_type === mark ? null : mark;
      client.setQueriesData({ queryKey: ["anime-calendar"] }, (value: unknown) => updateMark(value, item.id, next));
      return { previous, next };
    },
    onError: (_error, _variables, context) => { for (const [key, value] of context?.previous ?? []) client.setQueryData(key, value); notify("error", "标记失败，请稍后重试"); },
    onSuccess: (_result, { mark }, context) => notify("success", context?.next ? (mark === "watching" ? "已关注" : "已屏蔽") : (mark === "watching" ? "已取消关注" : "已取消屏蔽")),
    onSettled: () => void client.invalidateQueries({ queryKey: ["anime-calendar"] }),
  });
}

export function useRefreshMutation(year: number, month: number) {
  const client = useQueryClient();
  return useMutation<Awaited<ReturnType<typeof animeApi.refresh>>, Error, void, { toastId: string | number }>({
    mutationFn: () => animeApi.refresh(year, month),
    onMutate: () => ({ toastId: notify("loading", "正在刷新当前档期…") }),
    onSuccess: (result, _variables, context) => { notify("success", `刷新完成，共收录 ${result.total} 部`, context?.toastId); void client.invalidateQueries({ queryKey: ["anime-calendar"] }); },
    onError: (_error, _variables, context) => notify("error", "刷新失败，已保留现有数据", context?.toastId),
  });
}
export function useSaveSettingsMutation() { const client = useQueryClient(); return useMutation({ mutationFn: (settings: AnimeSettings) => animeApi.saveSettings(settings), onSuccess: (saved) => { client.setQueryData(calendarKeys.settings, saved); notify("success", "设置已保存"); }, onError: (error) => notify("error", error instanceof Error ? error.message : "设置保存失败") }); }

function updateMark(value: unknown, id: string, mark: AnimeMarkType | null): unknown {
  if (Array.isArray(value)) return value.map((item) => updateMark(item, id, mark));
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const next = Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, updateMark(entry, id, mark)]));
  return record.id === id ? { ...next, mark_type: mark } : next;
}
