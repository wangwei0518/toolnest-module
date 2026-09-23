import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BangumiProvider } from "../src/provider.js";

let server: Server;
let apiBase = "";
let multiPage = false;
let searchOffsets: number[] = [];

beforeEach(async () => {
  multiPage = false;
  searchOffsets = [];
  server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url?.startsWith("/v0/search/subjects")) {
      const url = new URL(request.url, "http://127.0.0.1");
      const offset = Number(url.searchParams.get("offset") ?? 0);
      searchOffsets.push(offset);
      if (multiPage) {
        const subjects = Array.from({ length: 45 }, (_, index) => ({
          id: index + 1,
          name: `Original ${index + 1}`,
          name_cn: `测试动画 ${index + 1}`,
          date: "2026-07-03",
          eps: 12,
          rating: { score: 8.3 },
          images: { large: `https://img.example/${index + 1}.jpg` },
          tags: [{ name: "日本" }],
        }));
        response.end(JSON.stringify({ total: subjects.length, data: subjects.slice(offset, offset + 20) }));
        return;
      }
      response.end(JSON.stringify({ total: 1, data: [{ id: 42, name: "Original", name_cn: "测试动画", date: "2026-07-03", eps: 12, rating: { score: 8.3 }, images: { large: "https://img.example/42.jpg" }, tags: [{ name: "日本" }] }] }));
      return;
    }
    if (request.url === "/calendar") {
      response.end(JSON.stringify([{ weekday: { id: 5 }, items: [{ id: 42, name: "Original", name_cn: "测试动画", air_date: "2026-07-03", collection: { doing: 999 } }] }]));
      return;
    }
    if (request.url === "/v0/subjects/42") {
      response.end(JSON.stringify({ id: 42, name: "Original", name_cn: "测试动画", date: "2026-07-03", eps: 12, summary: "完整简介", tags: [{ name: "日本" }] }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ message: "not found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("测试服务启动失败");
  apiBase = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });

describe("BangumiProvider", () => {
  it("maps and deduplicates cour subjects", async () => {
    const items = await new BangumiProvider("", apiBase).fetchCour(2026, 7);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "bangumi:42", title_cn: "测试动画", episode_count: 12, score: 8.3, region: "jp" });
  });

  it("estimates a weekly series end date from its episode count", async () => {
    const items = await new BangumiProvider("", apiBase).fetchCour(2026, 7);
    expect(items[0]?.estimated_end_date).toBe("2026-09-18");
  });

  it("follows the actual response page size when the provider returns fewer than requested", async () => {
    multiPage = true;
    const items = await new BangumiProvider("", apiBase).fetchCour(2026, 7);
    expect(items).toHaveLength(45);
    expect(searchOffsets).toEqual([0, 20, 40]);
  });

  it("does not mistake collection popularity for the current episode", async () => {
    const items = await new BangumiProvider("", apiBase).fetchWeekly();
    expect(items[0]).toMatchObject({ weekday: 5, current_episode: null, status: "airing", estimated_end_date: null });
  });

  it("loads full details on demand", async () => {
    const detail = await new BangumiProvider("", apiBase).fetchDetail("42");
    expect(detail.summary).toBe("完整简介");
  });
});
