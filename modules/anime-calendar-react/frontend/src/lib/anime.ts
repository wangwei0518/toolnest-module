import type { AnimeListItem, AnimeMediaType, AnimeRegion, AnimeStatus } from "@/types";

export const regionOptions = [
  ["all", "全部地区"], ["jp", "日本"], ["cn", "中国"], ["western", "欧美"], ["kr", "韩国"], ["other", "其他"], ["unknown", "未知"],
] as const;
export const weekdayOptions = [[0, "未定"], [1, "周一"], [2, "周二"], [3, "周三"], [4, "周四"], [5, "周五"], [6, "周六"], [7, "周日"]] as const;
export const mediaLabels: Record<AnimeMediaType, string> = { tv: "TV", movie: "剧场版", ova: "OVA", ona: "ONA", sp: "SP", unknown: "未知" };
export const statusLabels: Record<AnimeStatus, string> = { not_started: "未开播", airing: "放送中", finished: "已完结", unknown: "未知" };
export const displayTitle = (item: AnimeListItem) => item.title_cn || item.title_original;
export const weekdayLabel = (weekday: number) => weekdayOptions.find(([value]) => value === weekday)?.[1] ?? "未定";
export const regionLabel = (region: string) => regionOptions.find(([value]) => value === region)?.[1] ?? "未知";
export const airInfo = (item: AnimeListItem) => item.air_date ? `${weekdayLabel(item.weekday)} · ${item.air_date}${item.air_time ? ` ${item.air_time}` : ""}` : "播出时间未定";

export function filterItems(items: AnimeListItem[], options: { keyword: string; weekday: number | null; status: AnimeStatus | null; mediaType: AnimeMediaType | null; markType: "watching" | "ignored" | null; region: string; showContinuing: boolean; showUnknown: boolean; sort: "default" | "score"; }) {
  const keyword = options.keyword.trim().toLocaleLowerCase();
  const result = items.filter((item) => {
    if (!options.markType && item.mark_type === "ignored") return false;
    if (options.weekday !== null && item.weekday !== options.weekday) return false;
    if (options.status && item.status !== options.status) return false;
    if (options.mediaType && item.media_type !== options.mediaType) return false;
    if (options.markType && item.mark_type !== options.markType) return false;
    if (options.region !== "all" && item.region !== options.region) return false;
    if (!options.showContinuing && item.cour_relation === "continuing") return false;
    if (!options.showUnknown && item.region === "unknown") return false;
    return !keyword || [displayTitle(item), item.title_original, item.studio].some((value) => value.toLocaleLowerCase().includes(keyword));
  });
  return [...result].sort((a, b) => {
    const watching = Number(b.mark_type === "watching") - Number(a.mark_type === "watching");
    if (watching) return watching;
    if (options.sort === "score") return (b.score ?? -1) - (a.score ?? -1) || (a.air_date ?? "9999").localeCompare(b.air_date ?? "9999");
    return (b.score ?? 0) - (a.score ?? 0) || (a.air_date ?? "9999").localeCompare(b.air_date ?? "9999");
  });
}

export function currentDateParts(timeZone: string) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  const weekday = ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 } as Record<string, number>)[values.weekday ?? ""] ?? 0;
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day), weekday, key: `${values.year}-${values.month}-${values.day}` };
}

export function fallbackCover(item: Pick<AnimeListItem, "id" | "title_cn" | "title_original">) {
  const title = (item.title_cn || item.title_original).slice(0, 8).replace(/[<>&"']/g, "");
  const hue = [...item.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="hsl(${hue} 72% 52%)"/><stop offset="1" stop-color="hsl(${(hue + 48) % 360} 48% 14%)"/></linearGradient></defs><rect width="300" height="400" fill="url(#g)"/><text x="24" y="342" fill="white" font-size="25" font-family="sans-serif" font-weight="700">${title}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export function coverUrl(url: string, width: 200 | 400 | 800 = 800) {
  if (!url) return "";
  if (url.includes("/r/")) {
    return url.replace(/\/r\/(\d+)\//, `/r/${width}/`);
  }
  return url.includes("/pic/cover/") ? url.replace("/pic/cover/", `/r/${width}/pic/cover/`) : url;
}

export function nextCour(year: number, month: number, direction: -1 | 1) { if (direction === 1) return month === 10 ? { year: year + 1, month: 1 } : { year, month: month + 3 }; return month === 1 ? { year: year - 1, month: 10 } : { year, month: month - 3 }; }
export function weekState(weekday: number, today: number) { if (weekday === today) return "today" as const; return weekday > today ? "upcoming" as const : "past" as const; }
export type RegionFilter = AnimeRegion | "all";
