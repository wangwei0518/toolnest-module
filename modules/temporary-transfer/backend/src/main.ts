import Fastify, { type FastifyInstance } from "fastify";
import { mkdir } from "node:fs/promises";

import { config } from "./config.js";
import { LocalStorage } from "./local-storage.js";
import { CleanupError, cleanupTransfers } from "./cleanup.js";
import { registerRoutes } from "./routes.js";
import { SettingsStore } from "./settings.js";
import { TransferStore } from "./store.js";

export async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await mkdir(config.dataDir, { recursive: true });
  await mkdir(config.logDir, { recursive: true });
  const store = new TransferStore(config.dataDir);
  const settings = new SettingsStore(config.dataDir);
  await settings.load();

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

  const initializing = new Set<string>();
  const local = new LocalStorage(config.dataDir);
  registerRoutes(app, store, settings, initializing, { apiUrl: config.platformApiUrl, moduleId: config.moduleId, token: config.token }, local);
  let cleanup: Promise<void> | undefined;
  let lastFailure = "";
  let lastFailureLoggedAt = 0;
  const runCleanup = () => {
    if (cleanup) return;
    cleanup = cleanupTransfers(store, settings, initializing, local)
      .then(() => { lastFailure = ""; })
      .catch((error: unknown) => {
        const reason = error instanceof CleanupError ? error.message : "未知错误";
        const now = Date.now();
        if (reason !== lastFailure || now - lastFailureLoggedAt >= 15 * 60_000) {
          console.warn(`临时投递清理任务失败：${reason}，将稍后重试`);
          lastFailure = reason;
          lastFailureLoggedAt = now;
        }
      }).finally(() => { cleanup = undefined; });
  };
  runCleanup();
  const timer = setInterval(runCleanup, 60_000);
  timer.unref();
  app.addHook("onClose", async () => { clearInterval(timer); await cleanup; store.close(); });

  return app;
}

if (process.env.NODE_ENV !== "test") {
  void createApp().then(async (app) => {
    await app.listen({ host: "127.0.0.1", port: config.port });
  });
}
