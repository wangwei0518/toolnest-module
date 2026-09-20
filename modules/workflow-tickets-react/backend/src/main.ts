import Fastify, { type FastifyInstance } from "fastify";
import { mkdir } from "node:fs/promises";

import { config } from "./config.js";
import { registerRoutes } from "./routes.js";
import { WorkflowTicketsService } from "./service.js";
import { PostgresStore } from "./postgres-store.js";

export async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await mkdir(config.dataDir, { recursive: true });
  await mkdir(config.logDir, { recursive: true });
  const store = new PostgresStore(config.dataDir, config.databaseUrl, config.databaseSchema, config.databasePoolMax, {
    timeline: config.timelineHistoryMax,
    actionExecutions: config.actionExecutionHistoryMax,
    scheduleRuns: config.scheduleRunHistoryMax,
  });
  const service = new WorkflowTicketsService(store, config.moduleId, config.platformApiUrl, config.token);
  await service.init();
  await service.cleanupTemporaryResources();

  app.addHook("onRequest", async (request, reply) => {
    if (request.url.startsWith("/temp/")) return;
    if (request.headers["x-toolnest-internal-token"] !== config.token) {
      return reply.code(401).send({
        code: 401,
        message: "module authentication required",
        data: null,
      });
    }
  });

  app.get("/health/ready", async () => ({
    ready: true,
    module_id: config.moduleId,
    release_id: config.releaseId,
  }));

  app.get("/hello", async () => ({
    message: "工单模板 模块已连接。",
  }));

  registerRoutes(app, service);
  let backgroundRun: Promise<void> | undefined;
  const runBackgroundTasks = () => {
    if (backgroundRun) return;
    backgroundRun = Promise.allSettled([
      service.runDueSchedules(),
      service.runDueReminders(),
      service.runDueProjectNotifications(),
      service.cleanupTemporaryResources(),
    ]).then(() => undefined).finally(() => { backgroundRun = undefined; });
  };
  const timer = setInterval(runBackgroundTasks, 30_000);
  timer.unref();
  app.addHook("onClose", async () => {
    clearInterval(timer);
    await backgroundRun;
    await store.close();
  });

  return app;
}

if (process.env.NODE_ENV !== "test" || process.env.TOOLNEST_PLUGIN_PORT) {
  void createApp().then(async (app) => {
    await app.listen({ host: "127.0.0.1", port: config.port });
  });
}
