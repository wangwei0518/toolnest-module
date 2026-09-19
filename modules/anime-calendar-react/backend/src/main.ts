import Fastify, { type FastifyInstance } from "fastify";
import { mkdir } from "node:fs/promises";

import { config } from "./config.js";
import { BangumiProvider } from "./provider.js";
import { registerRoutes } from "./routes.js";
import { AnimeCalendarService } from "./service.js";
import { JsonStore } from "./store.js";

export async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await mkdir(config.dataDir, { recursive: true });
  await mkdir(config.logDir, { recursive: true });
  const store = new JsonStore(config.dataDir);
  await store.init();
  const settings = store.snapshot().settings;
  const provider = new BangumiProvider(settings.proxy.enabled ? settings.proxy.url : "");
  const service = new AnimeCalendarService(store, provider, config.moduleId, config.platformApiUrl, config.token);

  app.addHook("onRequest", async (request, reply) => {
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

  app.get("/hello", async () => ({ message: "新番日历模块已连接。" }));

  registerRoutes(app, service);
  const timer = setInterval(() => { void service.runDueNotifications().catch(() => undefined); }, 60_000);
  timer.unref();
  app.addHook("onClose", async () => { clearInterval(timer); });

  return app;
}

if (process.env.NODE_ENV !== "test" || process.env.TOOLNEST_PLUGIN_PORT) {
  void createApp().then(async (app) => {
    await app.listen({ host: "127.0.0.1", port: config.port });
  });
}
