import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";

import { config } from "./config.js";
import { WallpaperService, isSupportedUploadMime } from "./service.js";
import { WallpaperError } from "./errors.js";
import { WallpaperStorage } from "./storage.js";
import { MAX_UPLOAD_BYTES, type CropRect, type WallpaperAsset } from "./types.js";

export interface CreateAppOptions {
  dataDir?: string;
  token?: string;
}

function ownerId(request: FastifyRequest): string {
  const value = request.headers["x-toolnest-user-id"];
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new WallpaperError(401, "无法识别当前用户，请重新登录后重试。");
  }
  return value;
}

function objectParam(request: FastifyRequest, name: string): string {
  const value = (request.params as Record<string, unknown>)[name];
  if (typeof value !== "string") throw new WallpaperError(400, "请求参数无效。");
  return value;
}

function cropBody(request: FastifyRequest): CropRect {
  const value = request.body as Partial<CropRect> | null;
  if (!value || typeof value !== "object") throw new WallpaperError(422, "请提供图片裁切范围。");
  return value as CropRect;
}

function safeDownloadName(title: string, extension: string): string {
  const stem = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 80) || "背屏壁纸";
  return `${stem}.${extension}`;
}

async function readUpload(
  request: FastifyRequest,
  dataDir: string,
  currentOwnerId: string,
): Promise<{ path: string; originalName: string; crop: unknown; motionVideoPath?: string; presentationTimestampUs?: unknown }> {
  const stagingDirectory = path.join(dataDir, "incoming", currentOwnerId);
  await mkdir(stagingDirectory, { recursive: true });
  const stagedPath = path.join(stagingDirectory, `${randomUUID()}.upload`);
  let originalName = "wallpaper";
  let crop: unknown;
  let motionVideoPath: string | undefined;
  let presentationTimestampUs: unknown;
  let fileFound = false;
  let totalSize = 0;
  let imageSize = 0;
  try {
    for await (const part of request.parts({ limits: { files: 2, fields: 3, fileSize: MAX_UPLOAD_BYTES } })) {
      if (part.type === "file") {
        const isMotionVideo = part.fieldname === "motionVideo";
        if (isMotionVideo) {
          if (motionVideoPath) throw new WallpaperError(422, "动态照片只能包含一个视频轨道。");
          if (part.mimetype !== "video/mp4") throw new WallpaperError(415, "动态照片视频必须为 MP4 格式。");
          motionVideoPath = path.join(stagingDirectory, `${randomUUID()}.motion.upload`);
          part.file.on("data", (chunk: Buffer) => {
            totalSize += chunk.length;
            if (totalSize > MAX_UPLOAD_BYTES * 2) part.file.destroy(new WallpaperError(413, "图片和视频总大小不能超过 60 MB。"));
          });
          await pipeline(part.file, createWriteStream(motionVideoPath, { flags: "wx" }));
          if (part.file.truncated) throw new WallpaperError(413, "动态视频不能超过 30 MB。");
          continue;
        }
        if (part.fieldname !== "file" || fileFound) throw new WallpaperError(422, "一次只能上传一张图片。");
        fileFound = true;
        if (!isSupportedUploadMime(part.mimetype)) throw new WallpaperError(415, "仅支持 JPG、PNG、WebP 或含动态内容的 Live Photo JPG。");
        originalName = path.basename(part.filename || originalName).slice(0, 180);
        part.file.on("data", (chunk: Buffer) => {
          totalSize += chunk.length;
          imageSize += chunk.length;
          if (imageSize > MAX_UPLOAD_BYTES) part.file.destroy(new WallpaperError(413, "图片文件不能超过 30 MB。"));
          if (totalSize > MAX_UPLOAD_BYTES * 2) part.file.destroy(new WallpaperError(413, "图片和视频总大小不能超过 60 MB。"));
        });
        await pipeline(part.file, createWriteStream(stagedPath, { flags: "wx" }));
        if (part.file.truncated) throw new WallpaperError(413, "图片文件不能超过 30 MB。");
      } else if (part.fieldname === "crop" && typeof part.value === "string") {
        try {
          crop = JSON.parse(part.value);
        } catch {
          throw new WallpaperError(422, "裁切范围格式无效。");
        }
      } else if (part.fieldname === "presentationTimestampUs" && typeof part.value === "string") {
        presentationTimestampUs = part.value;
      } else {
        throw new WallpaperError(422, "上传参数无效。");
      }
    }
    if (!fileFound) throw new WallpaperError(400, "请选择要上传的图片。");
    return { path: stagedPath, originalName, crop, motionVideoPath, presentationTimestampUs };
  } catch (error) {
    await rm(stagedPath, { force: true });
    if (motionVideoPath) await rm(motionVideoPath, { force: true });
    if (error instanceof WallpaperError) throw error;
    const errorCode = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (errorCode === "FST_REQ_FILE_TOO_LARGE") {
      throw new WallpaperError(413, "图片文件不能超过 30 MB。");
    }
    throw error;
  }
}

async function readCropUpdate(request: FastifyRequest, dataDir: string, currentOwnerId: string) {
  if (!request.isMultipart()) return { crop: cropBody(request), motionVideoPath: undefined, presentationTimestampUs: undefined };
  const stagingDirectory = path.join(dataDir, "incoming", currentOwnerId);
  await mkdir(stagingDirectory, { recursive: true });
  let crop: unknown;
  let motionVideoPath: string | undefined;
  let presentationTimestampUs: unknown;
  try {
    for await (const part of request.parts({ limits: { files: 1, fields: 2, fileSize: MAX_UPLOAD_BYTES } })) {
      if (part.type === "file") {
        if (part.fieldname !== "motionVideo" || motionVideoPath) throw new WallpaperError(422, "裁切参数无效。");
        if (part.mimetype !== "video/mp4") throw new WallpaperError(415, "动态照片视频必须为 MP4 格式。");
        motionVideoPath = path.join(stagingDirectory, `${randomUUID()}.motion.upload`);
        let totalSize = 0;
        part.file.on("data", (chunk: Buffer) => {
          totalSize += chunk.length;
          if (totalSize > MAX_UPLOAD_BYTES) part.file.destroy(new WallpaperError(413, "动态视频不能超过 30 MB。"));
        });
        await pipeline(part.file, createWriteStream(motionVideoPath, { flags: "wx" }));
        if (part.file.truncated) throw new WallpaperError(413, "动态视频不能超过 30 MB。");
      } else if (part.fieldname === "crop" && typeof part.value === "string") {
        try { crop = JSON.parse(part.value); }
        catch { throw new WallpaperError(422, "裁切范围格式无效。"); }
      } else if (part.fieldname === "presentationTimestampUs" && typeof part.value === "string") {
        presentationTimestampUs = part.value;
      } else {
        throw new WallpaperError(422, "裁切参数无效。");
      }
    }
    if (!crop) throw new WallpaperError(422, "请提供图片裁切范围。");
    return { crop, motionVideoPath, presentationTimestampUs };
  } catch (error) {
    if (motionVideoPath) await rm(motionVideoPath, { force: true });
    throw error;
  }
}

export async function createApp(options: CreateAppOptions = {}): Promise<FastifyInstance> {
  const dataDir = path.resolve(options.dataDir ?? config.dataDir);
  const expectedToken = options.token ?? config.token;
  const storage = new WallpaperStorage(dataDir);
  const service = new WallpaperService(storage);
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });

  await mkdir(dataDir, { recursive: true });
  await app.register(multipart, {
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 2, fields: 3, parts: 5 },
  });
  app.addHook("onRequest", async (request, reply) => {
    if (request.headers["x-toolnest-internal-token"] !== expectedToken) {
      return reply.code(401).send({ code: 401, message: "模块认证失败。", data: null });
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    const errorStatusCode = error && typeof error === "object" && "statusCode" in error
      ? error.statusCode
      : undefined;
    const statusCode = error instanceof WallpaperError
      ? error.statusCode
      : typeof errorStatusCode === "number" && errorStatusCode >= 400 && errorStatusCode < 500
        ? errorStatusCode
        : 500;
    const message = error instanceof WallpaperError
      ? error.message
      : statusCode === 500
        ? "模块暂时无法完成请求，请稍后重试。"
        : error instanceof Error ? error.message : "请求失败。";
    return reply.code(statusCode).send({ code: statusCode, message, data: null });
  });

  await service.initialize();

  app.get("/health/ready", async () => ({
    ready: true,
    module_id: config.moduleId,
    release_id: config.releaseId,
  }));

  app.get("/wallpapers", async (request) => service.list(ownerId(request)));
  app.post("/wallpapers", async (request) => {
    const currentOwnerId = ownerId(request);
    const upload = await readUpload(request, dataDir, currentOwnerId);
    try {
      return await service.create(currentOwnerId, upload.path, upload.originalName, upload.crop, upload.motionVideoPath, upload.presentationTimestampUs);
    } finally {
      await Promise.all([
        rm(upload.path, { force: true }),
        upload.motionVideoPath ? rm(upload.motionVideoPath, { force: true }) : Promise.resolve(),
      ]);
    }
  });
  app.get<{ Params: { id: string } }>("/wallpapers/:id", async (request) =>
    service.get(ownerId(request), objectParam(request, "id")),
  );
  app.put<{ Params: { id: string } }>("/wallpapers/:id/crop", async (request) => {
    const currentOwnerId = ownerId(request);
    const update = await readCropUpdate(request, dataDir, currentOwnerId);
    try {
      return await service.updateCrop(currentOwnerId, objectParam(request, "id"), update.crop, update.motionVideoPath, update.presentationTimestampUs);
    } finally {
      if (update.motionVideoPath) await rm(update.motionVideoPath, { force: true });
    }
  });
  app.get<{ Params: { jobId: string } }>("/jobs/:jobId", async (request) =>
    service.job(ownerId(request), objectParam(request, "jobId")),
  );
  app.get<{ Params: { id: string; asset: string } }>("/wallpapers/:id/:asset", async (request, reply) => {
    const asset = objectParam(request, "asset");
    if (asset !== "source" && asset !== "preview" && asset !== "export") {
      throw new WallpaperError(404, "没有找到请求的图片文件。");
    }
    const result = await service.asset(ownerId(request), objectParam(request, "id"), asset as WallpaperAsset);
    const extension = asset === "preview" ? "webp" : asset === "export" ? (result.record.motionPhoto ? "jpg" : result.record.format === "gif" ? "gif" : "png") : result.record.format;
    const disposition = asset === "export" ? "attachment" : "inline";
    reply
      .type(result.contentType)
      .header("Content-Disposition", `${disposition}; filename="${safeDownloadName(result.record.title, extension)}"`)
      .header("Cache-Control", "private, no-store");
    return reply.send(createReadStream(result.filename));
  });
  app.delete<{ Params: { id: string } }>("/wallpapers/:id", async (request, reply) => {
    await service.delete(ownerId(request), objectParam(request, "id"));
    return reply.code(204).send();
  });

  app.addHook("onClose", async () => undefined);
  return app;
}

if (process.env.NODE_ENV !== "test" && process.env.VITEST !== "true") {
  void createApp().then(async (app) => {
    await app.listen({ host: "127.0.0.1", port: config.port });
  });
}
