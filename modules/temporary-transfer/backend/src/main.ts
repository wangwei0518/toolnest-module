import Fastify, { type FastifyInstance } from "fastify";
import { mkdir } from "node:fs/promises";

import { config } from "./config.js";
import { R2Storage } from "./r2.js";
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
  registerRoutes(app, store, settings, initializing, { apiUrl: config.platformApiUrl, moduleId: config.moduleId, token: config.token });
  let cleanup: Promise<void> | undefined;
  const runCleanup = () => {
    if (cleanup) return;
    cleanup = (async () => {
      store.purgeExpiredText();
      const r2Config = settings.get().r2;
      if (!r2Config) return;
      const r2 = new R2Storage(r2Config);
      for (const file of store.cleanupCandidates()) {
        if (initializing.has(file.id)) continue;
        try {
          if (file.upload_id && file.upload_id !== "single-empty") {
            try { await r2.abort(file.object_key, file.upload_id); }
            catch (error) { if (!(error instanceof Error) || error.name !== "NoSuchUpload") throw error; }
          }
          await r2.remove(file.object_key);
          store.forgetFile(file.id);
        } catch {
          // Keep the record and quota reservation so the next sweep can retry.
          store.markCleanupFailure(file.id);
          console.warn(`临时投递文件 ${file.id} 清理失败，将稍后重试`);
        }
      }
    })().catch(() => { console.warn("临时投递清理任务失败，将稍后重试"); }).finally(() => { cleanup = undefined; });
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
