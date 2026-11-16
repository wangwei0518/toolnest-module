import type { FastifyInstance, FastifyRequest } from "fastify";
import { createReadStream } from "node:fs";
import path from "node:path";
import { R2Storage } from "./r2.js";
import { SettingsStore } from "./settings.js";
import { TransferStore } from "./store.js";
import { VerificationLimiter } from "./rate-limit.js";

const PART_SIZE = 5 * 1024 * 1024;
const EMPTY_UPLOAD = "single-empty";
const limiter = new VerificationLimiter();
const idPattern = /^[A-Za-z0-9_-]{32}$/;

function owner(request: FastifyRequest) {
  const id = request.headers["x-toolnest-user-id"];
  if (typeof id !== "string" || !/^[0-9]{1,20}$/.test(id)) throw new Error("无法识别登录用户");
  return id;
}

function body(request: FastifyRequest): Record<string, unknown> {
  if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) throw new Error("请求格式无效");
  return request.body as Record<string, unknown>;
}

function params(request: FastifyRequest) { return request.params as Record<string, string>; }
function text(value: unknown, max: number) {
  if (typeof value !== "string" || value.length > max) throw new Error("输入内容无效");
  return value;
}
function integer(value: unknown, min: number, max: number) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new Error("输入数值超出允许范围");
  return value;
}

export function registerRoutes(app: FastifyInstance, store: TransferStore, settings: SettingsStore, initializing: Set<string>, platform?: { apiUrl: string; moduleId: string; token: string }) {
  const storage = () => {
    const config = settings.get().r2;
    if (!config) throw new Error("尚未配置 R2 存储");
    return new R2Storage(config);
  };

  app.get("/public/assets/:asset", async (request, reply) => {
    const asset = params(request).asset;
    if (asset !== "guest.js" && asset !== "guest.css") return reply.code(404).send();
    const file = path.join(process.cwd(), "frontend", "dist", asset);
    return reply.type(asset.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/css; charset=utf-8")
      .header("x-content-type-options", "nosniff").send(createReadStream(file));
  });
  app.get("/public/:id", async (request, reply) => {
    if (!idPattern.test(params(request).id ?? "")) return reply.code(404).send();
    return reply.type("text/html; charset=utf-8").header("cache-control", "no-store")
      .header("referrer-policy", "no-referrer").header("x-content-type-options", "nosniff")
      .header("content-security-policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
      .send('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>接收临时投递</title><link rel="stylesheet" href="/api/v1/modules/temporary-transfer/public/assets/guest.css"></head><body><div id="root"></div><script type="module" src="/api/v1/modules/temporary-transfer/public/assets/guest.js"></script></body></html>');
  });

  app.setErrorHandler((error, _request, reply) => {
    const message = error instanceof Error ? error.message : "请求失败";
    if (message === "无法识别登录用户") return reply.code(401).send({ message });
    // Remote errors can include request metadata; do not expose signed URLs or credentials.
    if (["请求格式无效", "尚未配置 R2 存储", "输入内容无效", "输入数值超出允许范围", "输入内容不能为空", "输入类型无效", "输入文件名无效", "上传文件信息不一致", "投递不存在或已失效", "投递文件不存在或已失效", "投递已失效", "暂存空间不足", "有效投递数量已达上限", "单次投递最多包含 20 个文件", "暂存空间中仍有文件，请先清理后再更换存储桶", "配置格式无效", "默认期限不能超过最大期限", "单文件上限不能超过总容量", "R2 配置无效", "R2 凭证或存储桶配置无效"].includes(message) || /^[a-zA-Z]+ 超出允许范围$/.test(message)) {
      return reply.code(400).send({ message });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) return reply.code(status).send({ message: "请求格式无效" });
    return reply.code(500).send({ message: "请求失败，请稍后重试" });
  });

  app.get("/transfer-settings", async (request) => {
    owner(request);
    let publicBaseUrl = "";
    if (platform?.apiUrl) {
      try {
        const response = await fetch(`${platform.apiUrl.replace(/\/$/, "")}/internal/modules/${encodeURIComponent(platform.moduleId)}/public-url`, {
          headers: { "x-toolnest-internal-token": platform.token }, signal: AbortSignal.timeout(3_000),
        });
        if (response.ok) {
          const result = await response.json() as { data?: { public_base_url?: unknown } };
          if (typeof result.data?.public_base_url === "string") {
            const url = new URL(result.data.public_base_url);
            if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password) {
              url.search = ""; url.hash = "";
              publicBaseUrl = url.toString().replace(/\/$/, "");
            }
          }
        }
      } catch { /* Use the browser origin when the platform has no public address. */ }
    }
    return { ...settings.publicValue(), publicBaseUrl };
  });
  app.put("/transfer-settings", async (request, reply) => {
    owner(request);
    if (request.headers["x-toolnest-user-is-admin"] !== "true") return reply.code(403).send({ message: "仅管理员可以修改配置" });
    const input = body(request);
    const existing = settings.get();
    const incoming = input.r2 as Record<string, unknown> | null | undefined;
    const r2 = incoming === undefined ? existing.r2 : incoming === null ? null : {
      accountId: incoming.accountId ?? existing.r2?.accountId,
      bucket: incoming.bucket ?? existing.r2?.bucket,
      accessKeyId: incoming.accessKeyId || existing.r2?.accessKeyId,
      secretAccessKey: incoming.secretAccessKey || existing.r2?.secretAccessKey,
    };
    if (store.hasFiles() && (!r2 || r2.accountId !== existing.r2?.accountId || r2.bucket !== existing.r2?.bucket)) {
      throw new Error("暂存空间中仍有文件，请先清理后再更换存储桶");
    }
    await settings.save({ ...existing, ...input, r2 });
    return settings.publicValue();
  });

  app.get("/transfers", async (request) => {
    const query = request.query as { offset?: string };
    const offset = integer(Number(query.offset ?? 0), 0, 1_000_000);
    return { ...store.list(owner(request), offset), usedBytes: store.usage(), maxBytes: settings.get().maxTotalBytes, cleanupFailures: store.cleanupFailures() };
  });
  app.post("/transfers", async (request, reply) => {
    const user = owner(request);
    const input = body(request);
    const title = text(input.title, 180).trim() || "临时投递";
    const hours = integer(input.hours ?? settings.get().defaultHours, 1, settings.get().maxHours);
    const maxGrants = input.maxGrants === undefined ? settings.get().defaultMaxGrants : input.maxGrants === null ? null : integer(input.maxGrants, 1, settings.get().maxGrantsAllowed);
    const expiresAt = Date.now() + hours * 3_600_000;
    if (input.kind === "text") {
      const content = text(input.content, 100_000);
      if (!content.trim()) throw new Error("输入内容不能为空");
      return reply.code(201).send(store.createText(user, title, content, expiresAt, maxGrants, settings.get().maxTotalBytes));
    }
    if (input.kind === "files") {
      storage();
      return reply.code(201).send(store.createFiles(user, title, expiresAt, maxGrants));
    }
    throw new Error("输入类型无效");
  });

  app.post("/transfers/:id/code", async (request, reply) => {
    const code = store.rotateCode(owner(request), params(request).id ?? "");
    return code ? { code } : reply.code(404).send({ message: "投递不存在或已失效" });
  });
  app.get("/transfers/:id/share", async (request, reply) => {
    const code = store.shareCode(owner(request), params(request).id ?? "");
    return code ? reply.header("cache-control", "no-store").send({ code }) : reply.code(404).send({ message: "分享信息不可用，请重新生成提取码" });
  });
  app.delete("/transfers/:id", async (request, reply) => {
    return store.revoke(owner(request), params(request).id ?? "") ? { ok: true } : reply.code(404).send({ message: "投递不存在或已撤销" });
  });

  app.post("/transfers/:id/files", async (request, reply) => {
    const user = owner(request); const id = params(request).id ?? ""; const input = body(request);
    const filename = text(input.filename, 180).trim();
    if (!filename || /[\u0000-\u001f\u007f]/.test(filename)) throw new Error("输入文件名无效");
    const clientId = text(input.clientId, 36);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientId)) throw new Error("输入内容无效");
    const size = integer(input.size, 0, settings.get().maxFileBytes);
    const r2 = storage();
    const file = store.addFile(user, id, clientId, filename, size, settings.get().maxTotalBytes);
    if (file.existing) {
      if (file.state !== "pending" || file.uploadId) return { id: file.id, partSize: PART_SIZE, partCount: Math.max(1, Math.ceil(size / PART_SIZE)) };
      if (initializing.has(file.id)) return reply.code(409).send({ message: "上传初始化中，请稍后重试" });
    }
    initializing.add(file.id);
    let uploadId: string | undefined;
    try {
      uploadId = size === 0 ? EMPTY_UPLOAD : await r2.start(file.key, filename);
      if (!store.setUploadId(file.id, uploadId)) throw new Error("投递已失效");
      if (size === 0) {
        await r2.putEmpty(file.key, filename);
        if (!store.markFileReady(file.id)) throw new Error("投递已失效");
      }
      return reply.code(201).send({ id: file.id, partSize: PART_SIZE, partCount: Math.max(1, Math.ceil(size / PART_SIZE)) });
    } catch (error) {
      let cleaned = !uploadId;
      if (uploadId === EMPTY_UPLOAD) {
        try { await r2.remove(file.key); cleaned = true; }
        catch { store.setUploadIdForCleanup(file.id, uploadId); }
      }
      else if (uploadId) {
        try { await r2.abort(file.key, uploadId); cleaned = true; }
        catch { store.setUploadIdForCleanup(file.id, uploadId); }
      }
      // Keep the reservation and upload ID when abort fails so expiry cleanup can retry.
      if (cleaned) store.forgetFile(file.id, true);
      throw error;
    } finally {
      initializing.delete(file.id);
    }
  });

  app.get("/transfers/:id/files/:file/parts", async (request, reply) => {
    const file = store.ownedFile(owner(request), params(request).id ?? "", params(request).file ?? "");
    if (!file) throw new Error("投递文件不存在或已失效");
    if (file.state === "ready") return { parts: [], completed: true };
    if (!file.upload_id) throw new Error("投递文件不存在或已失效");
    const r2 = storage();
    if (file.upload_id === EMPTY_UPLOAD) {
      if (await r2.hasCompletedObject(file.object_key, 0)) {
        if (!store.markFileReady(file.id)) { await r2.remove(file.object_key); throw new Error("投递已失效"); }
        return { parts: [], completed: true };
      }
      return { parts: [], completed: false };
    }
    try { return { parts: await r2.parts(file.object_key, file.upload_id), completed: false }; }
    catch (error) {
      if (error instanceof Error && error.name === "NoSuchUpload" && await r2.hasCompletedObject(file.object_key, file.size)) {
        if (!store.markFileReady(file.id)) { await r2.remove(file.object_key); throw new Error("投递已失效"); }
        return { parts: [], completed: true };
      }
      if (error instanceof Error && error.name === "NoSuchUpload") {
        if (initializing.has(file.id)) return reply.code(409).send({ message: "上传初始化中，请稍后重试" });
        initializing.add(file.id);
        let replacement: string | undefined;
        try {
          replacement = await r2.start(file.object_key, file.filename);
          if (!store.setUploadId(file.id, replacement)) throw new Error("投递已失效");
          return { parts: [], completed: false };
        } catch (restartError) {
          if (replacement) {
            try { await r2.abort(file.object_key, replacement); }
            catch { store.setUploadIdForCleanup(file.id, replacement); }
          }
          throw restartError;
        } finally { initializing.delete(file.id); }
      }
      throw error;
    }
  });
  app.post("/transfers/:id/files/:file/parts/:part", async (request) => {
    const file = store.ownedFile(owner(request), params(request).id ?? "", params(request).file ?? "");
    if (!file?.upload_id || file.state !== "pending") throw new Error("投递文件不存在或已失效");
    const part = integer(Number(params(request).part), 1, Math.max(1, Math.ceil(file.size / PART_SIZE)));
    if (file.upload_id === EMPTY_UPLOAD) throw new Error("投递文件不存在或已失效");
    const size = Math.min(PART_SIZE, file.size - (part - 1) * PART_SIZE);
    return { url: await storage().signPart(file.object_key, file.upload_id, part, size) };
  });
  app.post("/transfers/:id/files/:file/complete", async (request) => {
    const file = store.ownedFile(owner(request), params(request).id ?? "", params(request).file ?? "");
    if (file?.state === "ready") return { ok: true };
    if (!file?.upload_id || file.state !== "pending") throw new Error("投递文件不存在或已失效");
    const r2 = storage();
    if (file.upload_id === EMPTY_UPLOAD) {
      if (!await r2.hasCompletedObject(file.object_key, 0)) throw new Error("投递文件不存在或已失效");
    } else await r2.complete(file.object_key, file.upload_id, file.size, PART_SIZE);
    if (!store.markFileReady(file.id)) { await r2.remove(file.object_key); throw new Error("投递已失效"); }
    return { ok: true };
  });
  app.post("/transfers/:id/publish", async (request, reply) => {
    return store.publish(owner(request), params(request).id ?? "") ? { ok: true } : reply.code(409).send({ message: "投递尚未完成上传或已失效" });
  });

  function verify(request: FastifyRequest, code: unknown) {
    const id = params(request).id ?? "";
    if (!idPattern.test(id) || typeof code !== "string" || !/^\d{6}$/.test(code)) return null;
    if (!limiter.allow(id)) return "limited" as const;
    const result = store.verify(id, code);
    if (result) limiter.success(id);
    return result;
  }
  app.post("/public/:id/verify", async (request, reply) => {
    const result = verify(request, body(request).code);
    if (result === "limited") return reply.code(429).send({ message: "尝试过于频繁，请稍后再试" });
    if (!result) return reply.code(403).send({ message: "提取码无效或投递已失效" });
    return reply.header("cache-control", "no-store").send({ ...result, files: store.files(params(request).id ?? "") });
  });
  app.post("/public/:id/files/:file/download", async (request, reply) => {
    const code = body(request).code;
    const result = verify(request, code);
    if (result === "limited") return reply.code(429).send({ message: "尝试过于频繁，请稍后再试" });
    if (!result) return reply.code(403).send({ message: "提取码无效或投递已失效" });
    const transferId = params(request).id ?? "";
    const fileId = params(request).file ?? "";
    const file = store.fileGrantCandidate(transferId, fileId);
    if (!file) return reply.code(404).send({ message: "文件不可用或已达到授权次数限制" });
    const url = await storage().download(file.object_key);
    if (typeof code !== "string" || !store.claimFileGrant(transferId, fileId, code)) return reply.code(404).send({ message: "文件不可用或已达到授权次数限制" });
    return reply.header("cache-control", "no-store").send({ url });
  });
}
