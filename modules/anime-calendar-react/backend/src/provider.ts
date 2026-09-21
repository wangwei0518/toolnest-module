import http from "node:http";
import https from "node:https";
import { ProxyAgent } from "proxy-agent";

import { addMonths, courLabel, courRange, dateKey } from "./cour.js";
import type { AnimeItem, AnimeMediaType, AnimeRegion, AnimeStatus } from "./types.js";

type JsonObject = Record<string, unknown>;

export class BangumiProvider {
  constructor(private proxyUrl = "", private readonly apiBase = "https://api.bgm.tv") {}

  setProxyUrl(value: string) { this.proxyUrl = value; }

  async fetchCour(year: number, courMonth: number) {
    const range = courRange(year, courMonth);
    const candidateStart = addMonths(range.start, -6);
    const subjects: JsonObject[] = [];
    const requestedPageSize = 100;
    let offset = 0;
    while (offset < 1000) {
      const response = await this.requestJson("POST", `${this.apiBase}/v0/search/subjects`, {
        keyword: "",
        sort: "rank",
        filter: { type: [2], air_date: [`>=${dateKey(candidateStart)}`, `<=${range.end_date}`] },
      }, { limit: String(requestedPageSize), offset: String(offset) }) as JsonObject;
      const page = Array.isArray(response.data) ? response.data.filter(isObject) : [];
      if (!page.length) break;
      subjects.push(...page);
      // Bangumi may return fewer records than requested (currently 20 vs. limit=100).
      // Advance by the actual page size so later pages are not skipped.
      offset += page.length;
      const remoteTotal = typeof response.total === "number" && Number.isFinite(response.total) ? response.total : null;
      if (remoteTotal !== null && offset >= remoteTotal) break;
    }
    return dedupe(subjects).map((subject) => this.mapSubject(subject, year, courMonth));
  }

  async fetchWeekly() {
    const payload = await this.requestJson("GET", `${this.apiBase}/calendar`);
    if (!Array.isArray(payload)) throw new Error("Bangumi 周历响应格式异常");
    const result: AnimeItem[] = [];
    for (const [fallbackIndex, rawDay] of payload.entries()) {
      if (!isObject(rawDay)) continue;
      const weekday = isObject(rawDay.weekday) ? numberValue(rawDay.weekday.id) || fallbackIndex + 1 : fallbackIndex + 1;
      const items = Array.isArray(rawDay.items) ? rawDay.items.filter(isObject) : [];
      for (const subject of items) result.push(this.mapCalendarSubject(subject, weekday));
    }
    return dedupeItems(result);
  }

  async fetchDetail(providerId: string) {
    const payload = await this.requestJson("GET", `${this.apiBase}/v0/subjects/${encodeURIComponent(providerId)}`);
    if (!isObject(payload)) throw new Error("Bangumi 详情响应格式异常");
    const airDate = parseDate(payload.date);
    const courMonth = airDate ? resolveCourMonth(airDate.getUTCMonth() + 1) : currentCourMonth();
    const year = airDate?.getUTCFullYear() ?? new Date().getFullYear();
    return this.mapSubject(payload, year, courMonth);
  }

  private mapSubject(subject: JsonObject, year: number, courMonth: number): AnimeItem {
    const now = new Date().toISOString();
    const providerId = String(subject.id ?? "");
    const airDateValue = parseDate(subject.date ?? subject.air_date);
    const episodeCount = positiveInteger(subject.total_episodes ?? subject.eps);
    const tags = mapTags(subject.tags);
    const infobox = Array.isArray(subject.infobox) ? subject.infobox.filter(isObject) : [];
    const studio = infoboxValue(infobox, ["动画制作", "制作", "制作公司", "studio"]);
    const mediaType = mapMediaType(subject.platform ?? infoboxValue(infobox, ["类型", "播放平台"]));
    const estimatedEndDate = airDateValue ? estimatedEndDateFor(airDateValue, episodeCount, mediaType) : null;
    const region = inferRegion(subject, tags, studio);
    return {
      id: `bangumi:${providerId}`,
      provider: "bangumi",
      provider_id: providerId,
      title_cn: stringValue(subject.name_cn),
      title_original: stringValue(subject.name) || stringValue(subject.name_cn) || `Bangumi ${providerId}`,
      title_romaji: infoboxValue(infobox, ["英文名", "别名"]),
      cover_url: coverUrl(subject),
      studio,
      year,
      cour_month: courMonth,
      cour_label: courLabel(year, courMonth),
      air_date: airDateValue ? dateKey(airDateValue) : null,
      estimated_end_date: estimatedEndDate,
      cour_relation: "unknown",
      cour_relation_label: "未定",
      air_time: inferAirTime(subject),
      air_month: airDateValue ? airDateValue.toISOString().slice(0, 7) : "",
      weekday: weekdayValue(subject.air_weekday, airDateValue),
      status: mapStatus(airDateValue, estimatedEndDate ? new Date(`${estimatedEndDate}T00:00:00Z`) : null),
      media_type: mediaType,
      episode_count: episodeCount,
      current_episode: currentEpisode(subject),
      score: ratingScore(subject.rating),
      summary: stringValue(subject.summary),
      tags,
      external_url: `https://bgm.tv/subject/${providerId}`,
      region,
      raw: subject,
      created_at: now,
      updated_at: now,
      mark_type: null,
    };
  }

  private mapCalendarSubject(subject: JsonObject, weekday: number) {
    const airDate = parseDate(subject.air_date ?? subject.date);
    const year = airDate?.getUTCFullYear() ?? new Date().getFullYear();
    const month = resolveCourMonth(airDate ? airDate.getUTCMonth() + 1 : new Date().getMonth() + 1);
    const item = this.mapSubject(subject, year, month);
    return { ...item, weekday, media_type: mapCalendarMediaType(subject) };
  }

  private requestJson(method: "GET" | "POST", rawUrl: string, body?: unknown, query?: Record<string, string>) {
    const url = new URL(rawUrl);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const transport = url.protocol === "http:" ? http : https;
    const agent = this.proxyUrl ? new ProxyAgent({ getProxyForUrl: () => this.proxyUrl }) : undefined;
    return new Promise<unknown>((resolve, reject) => {
      const request = transport.request(url, {
        method,
        ...(agent ? { agent } : {}),
        headers: {
          accept: "application/json",
          "user-agent": "ToolNest-Anime-Calendar/0.1.0 (https://github.com/wangwei0518/toolnest-module)",
          ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
        },
        timeout: 25_000,
      }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`Bangumi 请求失败（HTTP ${response.statusCode ?? "未知"}）`)); return;
          }
          try { resolve(JSON.parse(text)); } catch { reject(new Error("Bangumi 返回了无法解析的数据")); }
        });
      });
      request.on("timeout", () => request.destroy(new Error("Bangumi 请求超时")));
      request.on("error", () => reject(new Error("无法连接 Bangumi，请检查网络或代理设置")));
      if (payload) request.write(payload);
      request.end();
    });
  }
}

function isObject(value: unknown): value is JsonObject { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function stringValue(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function numberValue(value: unknown) { const number = Number(value); return Number.isFinite(number) ? number : 0; }
function positiveInteger(value: unknown) { const number = Math.trunc(numberValue(value)); return number > 0 ? number : null; }
function parseDate(value: unknown) { const text = stringValue(value); if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null; const date = new Date(`${text}T00:00:00Z`); return Number.isNaN(date.getTime()) ? null : date; }
function resolveCourMonth(month: number) { return month >= 10 ? 10 : month >= 7 ? 7 : month >= 4 ? 4 : 1; }
function currentCourMonth() { return resolveCourMonth(new Date().getMonth() + 1); }
function estimatedEndDateFor(start: Date, episodeCount: number | null, mediaType: AnimeMediaType) {
  const episodes = episodeCount ?? defaultEpisodeCount(mediaType);
  return dateKey(new Date(start.getTime() + Math.max(0, episodes - 1) * 7 * 86400000));
}
function defaultEpisodeCount(mediaType: AnimeMediaType) { return mediaType === "movie" || mediaType === "ova" || mediaType === "sp" || mediaType === "unknown" ? 1 : 12; }
function mapStatus(start: Date | null, end: Date | null): AnimeStatus { const now = new Date(); if (!start) return "unknown"; if (start > now) return "not_started"; if (end && end < now) return "finished"; return "airing"; }
function weekdayValue(value: unknown, date: Date | null) { const explicit = numberValue(value); if (explicit >= 1 && explicit <= 7) return explicit; if (!date) return 0; return date.getUTCDay() || 7; }
function inferAirTime(subject: JsonObject) { const text = stringValue(subject.air_time); return /^\d{2}:\d{2}$/.test(text) ? text : ""; }
function ratingScore(value: unknown) { if (!isObject(value)) return null; const score = numberValue(value.score); return score > 0 ? Math.round(score * 10) / 10 : null; }
function currentEpisode(subject: JsonObject) { return positiveInteger(subject.current_episode ?? subject.currentEpisode ?? subject.episode); }
function mapTags(value: unknown) { if (!Array.isArray(value)) return []; return value.map((tag) => isObject(tag) ? stringValue(tag.name) : stringValue(tag)).filter(Boolean).slice(0, 24); }
function coverUrl(subject: JsonObject) { if (!isObject(subject.images)) return ""; return stringValue(subject.images.large) || stringValue(subject.images.common) || stringValue(subject.images.medium) || stringValue(subject.images.small); }
function infoboxValue(items: JsonObject[], keys: string[]) { const wanted = new Set(keys.map((key) => key.toLowerCase())); for (const item of items) { if (!wanted.has(stringValue(item.key).toLowerCase())) continue; const value = item.value; if (typeof value === "string") return value; if (Array.isArray(value)) return value.map((entry) => isObject(entry) ? stringValue(entry.v) : stringValue(entry)).filter(Boolean).join(" / "); } return ""; }
function mapMediaType(value: unknown): AnimeMediaType { const text = stringValue(value).toLowerCase(); if (/剧场|movie/.test(text)) return "movie"; if (/ova/.test(text)) return "ova"; if (/web|ona/.test(text)) return "ona"; if (/sp|special/.test(text)) return "sp"; if (/tv|电视/.test(text)) return "tv"; return "unknown"; }
function mapCalendarMediaType(subject: JsonObject): AnimeMediaType { const type = numberValue(subject.type); return type === 2 ? "tv" : mapMediaType(subject.type); }
function inferRegion(subject: JsonObject, tags: string[], studio: string): AnimeRegion { const text = [subject.name, subject.name_cn, subject.platform, studio, ...tags].map(stringValue).join(" ").toLowerCase(); if (/(中国|国产|国漫|国创|bilibili|腾讯|爱奇艺)/i.test(text)) return "cn"; if (/(韩国|韩漫)/i.test(text)) return "kr"; if (/(欧美|美国|英国|法国|netflix|disney|pixar|cartoon network)/i.test(text)) return "western"; if (/(日本|日漫|mappa|cloverworks|toei|bones|a-1 pictures)/i.test(text)) return "jp"; return "unknown"; }
function dedupe(subjects: JsonObject[]) { const seen = new Set<string>(); return subjects.filter((subject) => { const id = String(subject.id ?? ""); if (!id || seen.has(id)) return false; seen.add(id); return true; }); }
function dedupeItems(items: AnimeItem[]) { const seen = new Set<string>(); return items.filter((item) => { if (seen.has(item.id)) return false; seen.add(item.id); return true; }); }
