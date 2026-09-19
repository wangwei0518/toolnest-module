import type { FastifyInstance, FastifyRequest } from "fastify";

import { AnimeCalendarService, httpError } from "./service.js";
import type { AnimeMarkType } from "./types.js";

function numberQuery(value: unknown) { if (value === undefined || value === "") return undefined; const number = Number(value); if (!Number.isInteger(number)) throw httpError(400, "查询参数必须是整数"); return number; }
function booleanQuery(value: unknown) { return value === true || value === "true" || value === "1"; }

export function registerRoutes(app: FastifyInstance, service: AnimeCalendarService) {
  app.get("/cour/current", async () => service.currentCour());
  app.get("/items", async (request) => {
    const query = request.query as Record<string, unknown>;
    return service.listItems({
      year: numberQuery(query.year), cour_month: numberQuery(query.cour_month), weekday: numberQuery(query.weekday),
      status: typeof query.status === "string" ? query.status : undefined,
      media_type: typeof query.media_type === "string" ? query.media_type : undefined,
      keyword: typeof query.keyword === "string" ? query.keyword : undefined,
      mark_type: query.mark_type === "watching" || query.mark_type === "ignored" ? query.mark_type : undefined,
      include_ignored: booleanQuery(query.include_ignored),
    });
  });
  app.get("/items/:itemId", async (request) => service.getItem((request.params as { itemId: string }).itemId));
  app.get("/weekly", async (request) => service.weekly(booleanQuery((request.query as Record<string, unknown>).force)));
  app.get("/today", async () => service.today());
  app.post("/refresh", async (request) => { const body = request.body as Record<string, unknown>; return service.refresh(numberQuery(body.year), numberQuery(body.cour_month), booleanQuery(body.force)); });
  app.post("/long-running/refresh", async () => service.refreshLongRunning());
  app.post("/items/:itemId/mark", async (request) => { const mark = (request.body as { mark_type?: AnimeMarkType }).mark_type; if (mark !== "watching" && mark !== "ignored") throw httpError(422, "mark_type 只允许 watching 或 ignored"); return service.setMark((request.params as { itemId: string }).itemId, mark); });
  app.delete("/items/:itemId/mark", async (request) => service.setMark((request.params as { itemId: string }).itemId, null));
  app.get("/stats", async (request) => { const query = request.query as Record<string, unknown>; return service.stats(numberQuery(query.year), numberQuery(query.cour_month)); });
  app.get("/calendar-settings", async () => service.getSettings());
  app.put("/calendar-settings", async (request) => service.saveSettings(request.body));
  app.post("/connection-test", async (request) => service.testConnection((request.body as { settings?: unknown } | undefined)?.settings));
  app.post("/notifications/test-cour-release", async (request) => service.testNotification("cour", (request.body as { settings?: unknown } | undefined)?.settings));
  app.post("/notifications/test-watching-update", async (request) => service.testNotification("watching", (request.body as { settings?: unknown } | undefined)?.settings));

  app.setErrorHandler((error: unknown, _request: FastifyRequest, reply) => {
    const candidate = error instanceof Error ? error : new Error("未知错误");
    const status = "statusCode" in candidate && typeof candidate.statusCode === "number" ? candidate.statusCode : 500;
    const message = status >= 500 ? "新番日历服务暂时不可用" : candidate.message;
    void reply.code(status).send({ code: status, message, data: null });
  });
}
