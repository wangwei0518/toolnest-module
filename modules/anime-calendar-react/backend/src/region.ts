import type { AnimeItem, AnimeRegion, StoreState } from "./types.js";

const regionLabels: Array<[AnimeRegion, string[]]> = [
  ["jp", ["日本", "日本动画", "日漫", "日本国", "japan", "japanese", "jp"]],
  ["cn", ["中国", "中国大陆", "国产", "国产动画", "国漫", "国创", "china", "cn"]],
  ["kr", ["韩国", "韓國", "韩国动画", "korea", "south korea", "kr"]],
  ["western", ["欧美", "欧美动画", "美国", "英国", "法国", "加拿大", "德国", "意大利", "西班牙", "usa", "united states", "united kingdom", "france", "canada", "us", "uk"]],
];
const labels = new Map(regionLabels.flatMap(([region, values]) => values.map(value => [value, region] as const)));
const countryKeys = new Set(["国家", "地区", "国家/地区", "制作国家", "制作地区", "country", "region", "country of origin"]);

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value.trim().toLowerCase()];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return strings(object.v ?? object.value);
  }
  return [];
}

function identifiedRegions(values: string[]): Set<AnimeRegion> {
  return new Set(values.map(value => labels.get(value.trim().toLowerCase())).filter((region): region is AnimeRegion => region !== undefined));
}

function studioRegion(studio: string): AnimeRegion {
  if (/(?:mappa|cloverworks|toei|bones|a-1 pictures|toho\s*animation\s*studio|\bolm\b)/i.test(studio)) return "jp";
  if (/(?:disney|pixar|cartoon network)/i.test(studio)) return "western";
  return "unknown";
}

/** Production origin is distinct from story style, source material and distributors. */
export function inferRegion(subject: Record<string, unknown>, tags: string[], studio: string): AnimeRegion {
  const countries = [subject.country, subject.region, subject.country_of_origin].flatMap(strings);
  if (Array.isArray(subject.infobox)) {
    for (const field of subject.infobox) {
      if (!field || typeof field !== "object") continue;
      const entry = field as Record<string, unknown>;
      if (typeof entry.key === "string" && countryKeys.has(entry.key.trim().toLowerCase())) countries.push(...strings(entry.value));
    }
  }
  const explicit = identifiedRegions(countries.flatMap(value => value.split(/[\/、,，;；]/)));
  if (explicit.size === 1) return [...explicit][0]!;
  if (explicit.size > 1) return "unknown";
  // Exact tags: 中国风/中华风/国风 and 韩漫 describe setting/source, not origin.
  const tagged = identifiedRegions(tags);
  if (tagged.size === 1) return [...tagged][0]!;
  return studioRegion(studio);
}

/** Reuse stored provider evidence on load; no remote refresh or mark changes. */
export function reclassifyCachedRegions(state: StoreState): StoreState {
  const collections = [state.items, state.weeklyCache?.items ?? [], state.todayCache?.items ?? [], state.longRunningCache?.items ?? [], Object.values(state.detailCache).map(entry => entry.item)];
  const regionFor = (item: AnimeItem): AnimeRegion => {
    const region = inferRegion(item.raw ?? {}, item.tags ?? [], item.studio ?? "");
    // Imported/legacy records without raw provider evidence retain their known
    // region if the available metadata cannot identify a production origin.
    return region === "unknown" && !Object.keys(item.raw ?? {}).length ? item.region ?? region : region;
  };
  const known = new Map<string, AnimeRegion>();
  for (const items of collections) for (const item of items) {
    const region = regionFor(item);
    if (region !== "unknown") known.set(item.id, region);
  }
  for (const items of collections) for (const item of items) {
    const inferred = regionFor(item);
    item.region = inferred === "unknown" ? known.get(item.id) ?? inferred : inferred;
  }
  return state;
}
