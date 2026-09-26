import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import { config } from "./config.js";
import { WallpaperStorage } from "./storage.js";
import { assertMotionPhotoUpload, packageMotionPhoto, parsePresentationTimestamp, readEmbeddedMotionVideo } from "./live-photo.js";
import { WallpaperError } from "./errors.js";
import {
  MAX_UPLOAD_BYTES,
  TARGET_HEIGHT,
  TARGET_WIDTH,
  type CropRect,
  type ImageInfo,
  type ProcessingJob,
  type WallpaperFormat,
  type WallpaperRecord,
  type WallpaperSummary,
  type UploadResult,
} from "./types.js";

const targetRatio = TARGET_WIDTH / TARGET_HEIGHT;
const maximumFrames = 120;
const maximumDecodedPixels = 80_000_000;

function extensionFormat(format: string | undefined): WallpaperFormat {
  if (format === "jpeg") return "jpg";
  if (format === "png" || format === "webp" || format === "gif") return format;
  throw new WallpaperError(415, "仅支持 JPG、PNG 和 WebP 图片；动态壁纸请使用安卓 Live Photo JPG。");
}

function orientationDimensions(
  width: number,
  height: number,
  orientation?: number,
): { width: number; height: number } {
  return orientation && orientation >= 5 && orientation <= 8
    ? { width: height, height: width }
    : { width, height };
}

function defaultCrop(width: number, height: number): CropRect {
  const ratio = width / height;
  if (ratio > targetRatio) {
    const cropWidth = (targetRatio * height) / width;
    return { left: (1 - cropWidth) / 2, top: 0, width: cropWidth, height: 1 };
  }
  const cropHeight = width / targetRatio / height;
  return { left: 0, top: (1 - cropHeight) / 2, width: 1, height: cropHeight };
}

function normalizeCrop(value: unknown, width: number, height: number): CropRect {
  if (!value || typeof value !== "object") return defaultCrop(width, height);
  const crop = value as Partial<CropRect>;
  const numbers = [crop.left, crop.top, crop.width, crop.height];
  if (numbers.some((number) => typeof number !== "number" || !Number.isFinite(number))) {
    throw new WallpaperError(422, "裁切范围无效，请重新调整图片。");
  }
  const next = crop as CropRect;
  if (
    next.left < 0 ||
    next.top < 0 ||
    next.width <= 0 ||
    next.height <= 0 ||
    next.left + next.width > 1.00001 ||
    next.top + next.height > 1.00001
  ) {
    throw new WallpaperError(422, "裁切范围超出原图，请重新调整图片。");
  }
  const sourceRatio = (next.width * width) / (next.height * height);
  if (Math.abs(sourceRatio / targetRatio - 1) > 0.025) {
    throw new WallpaperError(422, "裁切区域比例不正确，请重新调整图片。");
  }
  return {
    left: next.left,
    top: next.top,
    width: next.width,
    height: next.height,
  };
}

function publicWallpaper(record: WallpaperRecord): WallpaperSummary {
  return {
    ...record,
    outputWidth: TARGET_WIDTH,
    outputHeight: TARGET_HEIGHT,
    outputFormat: record.motionPhoto ? "jpg" : record.format === "gif" ? "gif" : "png",
  };
}

function cleanTitle(filename: string): string {
  const base = path.basename(filename, path.extname(filename)).replace(/[\u0000-\u001f]/g, "").trim();
  return (base || "未命名壁纸").slice(0, 80);
}

function checkedCropPixels(crop: CropRect, width: number, height: number) {
  const left = Math.min(width - 1, Math.max(0, Math.round(crop.left * width)));
  const top = Math.min(height - 1, Math.max(0, Math.round(crop.top * height)));
  const cropWidth = Math.min(width - left, Math.max(1, Math.round(crop.width * width)));
  const cropHeight = Math.min(height - top, Math.max(1, Math.round(crop.height * height)));
  return { left, top, width: cropWidth, height: cropHeight };
}

export class WallpaperService {
  private readonly jobs = new Map<string, ProcessingJob>();

  constructor(private readonly storage = new WallpaperStorage(config.dataDir)) {}

  async initialize(): Promise<void> {
    for (const ownerId of await this.storage.listOwners()) {
      for (const record of await this.storage.list(ownerId)) {
        if (record.state !== "processing" || !record.jobId) continue;
        const job: ProcessingJob = {
          id: record.jobId,
          wallpaperId: record.id,
          state: "queued",
          progress: 0,
          message: "等待生成壁纸",
          error: null,
        };
        this.jobs.set(job.id, job);
        this.schedule(ownerId, record.id, job.id);
      }
    }
  }

  async list(ownerId: string): Promise<WallpaperSummary[]> {
    const records = await this.storage.list(ownerId);
    return records.map(publicWallpaper);
  }

  async get(ownerId: string, wallpaperId: string): Promise<WallpaperSummary> {
    const record = await this.requireWallpaper(ownerId, wallpaperId);
    return publicWallpaper(record);
  }

  async create(
    ownerId: string,
    stagedPath: string,
    originalName: string,
    cropValue: unknown,
    stagedMotionVideoPath?: string,
    presentationTimestampValue?: unknown,
  ): Promise<UploadResult> {
    const metadata = await this.inspect(stagedPath);
    const motionVideo = stagedMotionVideoPath ? await readFile(stagedMotionVideoPath) : undefined;
    assertMotionPhotoUpload(metadata.format === "jpg" ? "jpeg" : metadata.format, motionVideo);
    const embeddedMotion = motionVideo ? readEmbeddedMotionVideo(await readFile(stagedPath)) : null;
    if (motionVideo && !embeddedMotion) {
      throw new WallpaperError(422, "这张 JPG 没有可识别的安卓 Live Photo 视频，请选择包含动态内容的 MVIMG/JPG。 ");
    }
    const crop = normalizeCrop(cropValue, metadata.width, metadata.height);
    const id = randomUUID();
    const jobId = randomUUID();
    const motionVideoKey = motionVideo ? randomUUID() : undefined;
    const presentationTimestampUs = motionVideo
      ? parsePresentationTimestamp(presentationTimestampValue ?? embeddedMotion?.presentationTimestampUs)
      : undefined;
    const timestamp = new Date().toISOString();
    const record: WallpaperRecord = {
      id,
      title: cleanTitle(originalName),
      sourceName: path.basename(originalName).slice(0, 180) || "wallpaper",
      format: metadata.format,
      width: metadata.width,
      height: metadata.height,
      frames: metadata.frames,
      motionPhoto: Boolean(motionVideo),
      motionVideoKey,
      presentationTimestampUs,
      crop,
      state: "processing",
      error: null,
      jobId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const sourcePath = this.storage.sourcePath(ownerId, record);
    await mkdir(path.dirname(sourcePath), { recursive: true });
    try {
      await rename(stagedPath, sourcePath);
      if (stagedMotionVideoPath) await rename(stagedMotionVideoPath, this.storage.motionVideoPath(ownerId, record));
    } catch (error) {
      await rm(path.dirname(sourcePath), { recursive: true, force: true });
      throw error;
    }
    try {
      await this.storage.create(ownerId, record);
    } catch (error) {
      await rm(path.dirname(sourcePath), { recursive: true, force: true });
      throw error;
    }
    const job: ProcessingJob = {
      id: jobId,
      wallpaperId: id,
      state: "queued",
      progress: 0,
      message: "等待生成壁纸",
      error: null,
    };
    this.jobs.set(jobId, job);
    this.schedule(ownerId, id, jobId);
    return { wallpaper: publicWallpaper(record), job };
  }

  async updateCrop(
    ownerId: string,
    wallpaperId: string,
    cropValue: unknown,
    stagedMotionVideoPath?: string,
    presentationTimestampValue?: unknown,
  ): Promise<UploadResult> {
    const record = await this.requireWallpaper(ownerId, wallpaperId);
    const crop = normalizeCrop(cropValue, record.width, record.height);
    if (record.motionPhoto && !stagedMotionVideoPath) {
      throw new WallpaperError(422, "动态照片需要重新生成裁切后的视频，请重新打开作品后保存。");
    }
    if (!record.motionPhoto && stagedMotionVideoPath) {
      throw new WallpaperError(422, "这张作品不是动态照片，请重新上传 Live Photo。");
    }
    const motionVideo = stagedMotionVideoPath ? await readFile(stagedMotionVideoPath) : undefined;
    if (motionVideo) assertMotionPhotoUpload(record.format === "jpg" ? "jpeg" : record.format, motionVideo);
    const motionVideoKey = motionVideo ? randomUUID() : record.motionVideoKey;
    const presentationTimestampUs = motionVideo
      ? parsePresentationTimestamp(presentationTimestampValue ?? record.presentationTimestampUs)
      : record.presentationTimestampUs;
    const motionVideoRecord = motionVideoKey ? { ...record, motionVideoKey } : record;
    if (stagedMotionVideoPath && motionVideoKey) {
      await rename(stagedMotionVideoPath, this.storage.motionVideoPath(ownerId, motionVideoRecord));
    }
    const jobId = randomUUID();
    const updated = await this.storage.update(ownerId, wallpaperId, (item) => {
      item.crop = crop;
      item.motionVideoKey = motionVideoKey;
      item.presentationTimestampUs = presentationTimestampUs;
      item.state = "processing";
      item.error = null;
      item.jobId = jobId;
      item.updatedAt = new Date().toISOString();
    });
    if (!updated) {
      if (motionVideoRecord.motionVideoKey !== record.motionVideoKey) {
        await rm(this.storage.motionVideoPath(ownerId, motionVideoRecord), { force: true });
      }
      throw new WallpaperError(404, "没有找到这张作品。");
    }
    const job: ProcessingJob = {
      id: jobId,
      wallpaperId,
      state: "queued",
      progress: 0,
      message: "等待生成壁纸",
      error: null,
    };
    this.jobs.set(jobId, job);
    this.schedule(ownerId, wallpaperId, jobId);
    return { wallpaper: publicWallpaper(updated), job };
  }

  async job(ownerId: string, jobId: string): Promise<ProcessingJob> {
    const job = this.jobs.get(jobId);
    if (!job || !(await this.storage.get(ownerId, job.wallpaperId))) {
      throw new WallpaperError(404, "没有找到这项生成任务。");
    }
    return { ...job };
  }

  async delete(ownerId: string, wallpaperId: string): Promise<void> {
    const record = await this.requireWallpaper(ownerId, wallpaperId);
    if (record.jobId) this.jobs.delete(record.jobId);
    await this.storage.delete(ownerId, wallpaperId);
  }

  async asset(ownerId: string, wallpaperId: string, asset: "source" | "preview" | "export") {
    const record = await this.requireWallpaper(ownerId, wallpaperId);
    if (asset !== "source" && record.state !== "ready") {
      throw new WallpaperError(409, "壁纸还在生成中，请稍后再试。");
    }
    const filename = asset === "source"
      ? this.storage.sourcePath(ownerId, record)
      : asset === "preview"
        ? this.storage.previewPath(ownerId, record)
        : this.storage.exportPath(ownerId, record);
    const contentType = asset === "preview"
      ? "image/webp"
      : asset === "source"
        ? record.format === "jpg"
          ? "image/jpeg"
          : `image/${record.format}`
        : record.motionPhoto
          ? "image/jpeg"
          : record.format === "gif"
          ? "image/gif"
          : "image/png";
    return { filename, contentType, record };
  }

  private async requireWallpaper(ownerId: string, wallpaperId: string) {
    const record = await this.storage.get(ownerId, wallpaperId);
    if (!record) throw new WallpaperError(404, "没有找到这张作品。");
    return record;
  }

  private async inspect(sourcePath: string): Promise<ImageInfo & { format: WallpaperFormat }> {
    let metadata: sharp.Metadata;
    try {
      metadata = await sharp(await readFile(sourcePath), { animated: true, limitInputPixels: 100_000_000 }).metadata();
    } catch {
      throw new WallpaperError(422, "无法读取这张图片，请确认文件没有损坏。");
    }
    const format = extensionFormat(metadata.format);
    if (!metadata.width || !metadata.height) throw new WallpaperError(422, "图片缺少有效尺寸。");
    const dimensions = orientationDimensions(metadata.width, metadata.pageHeight ?? metadata.height, metadata.orientation);
    const frames = format === "gif" ? Math.max(1, metadata.pages ?? 1) : 1;
    if (dimensions.width > 16_000 || dimensions.height > 16_000) {
      throw new WallpaperError(413, "图片尺寸过大，请使用边长不超过 16000 像素的图片。");
    }
    if (frames > maximumFrames) {
      throw new WallpaperError(413, "GIF 帧数或总画面尺寸过大，请减少帧数或缩小图片后重试。");
    }
    if (dimensions.width * dimensions.height * frames > maximumDecodedPixels) {
      throw new WallpaperError(413, format === "gif"
        ? "GIF 帧数或总画面尺寸过大，请减少帧数或缩小图片后重试。"
        : "图片像素过多，请缩小图片后重试。");
    }
    return {
      width: dimensions.width,
      height: dimensions.height,
      frames,
      format,
      loop: metadata.loop ?? 0,
      delay: metadata.delay,
    };
  }

  private schedule(ownerId: string, wallpaperId: string, jobId: string): void {
    queueMicrotask(() => void this.process(ownerId, wallpaperId, jobId));
  }

  private async process(ownerId: string, wallpaperId: string, jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    const record = await this.storage.get(ownerId, wallpaperId);
    if (!job || !record || record.jobId !== jobId) return;
    job.state = "running";
    job.progress = 8;
    job.message = "正在读取图片帧";

    const sourcePath = this.storage.sourcePath(ownerId, record);
    const exportPath = this.storage.exportPath(ownerId, record);
    const previewPath = this.storage.previewPath(ownerId, record);
    const suffix = randomUUID();
    const temporaryExport = `${exportPath}.${suffix}.${record.format === "gif" ? "gif" : "png"}`;
    const temporaryPreview = `${previewPath}.${suffix}.webp`;
    try {
      const source = await readFile(sourcePath);
      const metadata = await sharp(source, {
        animated: record.format === "gif",
        limitInputPixels: 100_000_000,
      }).metadata();
      if (!metadata.width || !metadata.height) throw new Error("图片尺寸不可用");
      const dims = orientationDimensions(metadata.width, metadata.pageHeight ?? metadata.height, metadata.orientation);
      const crop = checkedCropPixels(record.crop, dims.width, dims.height);
      const createPipeline = (animated: boolean) =>
        sharp(source, { animated, limitInputPixels: 100_000_000 })
          .rotate()
          .extract(crop)
          .resize(TARGET_WIDTH, TARGET_HEIGHT, { fit: "fill", kernel: "lanczos3" });

      job.progress = 28;
      job.message = "正在按取景生成壁纸";
      const output = createPipeline(record.format === "gif" && !record.motionPhoto);
      if (record.motionPhoto) {
        job.message = "正在裁切动态视频并封装 Live Photo";
        job.progress = 52;
        const still = await output.jpeg({ quality: 94, chromaSubsampling: "4:2:0", mozjpeg: true }).toBuffer();
        const motionVideo = await readFile(this.storage.motionVideoPath(ownerId, record));
        await writeFile(temporaryExport, packageMotionPhoto(still, motionVideo, record.presentationTimestampUs ?? null));
      } else if (record.format === "gif") {
        const options: sharp.GifOptions = {
          loop: metadata.loop ?? 0,
          keepDuplicateFrames: true,
          effort: 5,
        };
        if (metadata.delay) options.delay = metadata.delay;
        await output.gif(options).toFile(temporaryExport);
      } else {
        await output.png({ compressionLevel: 8, palette: false }).toFile(temporaryExport);
      }

      job.progress = 78;
      job.message = "正在生成作品预览";
      const previewCrop = checkedCropPixels(record.crop, dims.width, dims.height);
      await sharp(source, {
        page: 0,
        limitInputPixels: 100_000_000,
      })
        .rotate()
        .extract(previewCrop)
        .resize(480, Math.round((480 * TARGET_HEIGHT) / TARGET_WIDTH), { fit: "fill" })
        .webp({ quality: 78 })
        .toFile(temporaryPreview);

      await Promise.all([
        rename(temporaryExport, exportPath),
        rename(temporaryPreview, previewPath),
      ]);
      const latest = await this.storage.update(ownerId, wallpaperId, (item) => {
        if (item.jobId !== jobId) return;
        item.state = "ready";
        item.error = null;
        item.updatedAt = new Date().toISOString();
      });
      if (latest?.jobId !== jobId) return;
      job.state = "completed";
      job.progress = 100;
      job.message = "壁纸已生成";
    } catch (error) {
      await Promise.all([
        rm(temporaryExport, { force: true }),
        rm(temporaryPreview, { force: true }),
      ]);
      const current = await this.storage.update(ownerId, wallpaperId, (item) => {
        if (item.jobId !== jobId) return;
        item.state = "failed";
        item.error = "图片处理失败，请重新调整裁切范围或换一张图片重试。";
        item.updatedAt = new Date().toISOString();
      });
      job.state = "failed";
      job.error = current?.error ?? (error instanceof Error ? error.message : "图片处理失败。");
      job.message = "图片生成失败";
    }
  }
}

export function isSupportedUploadMime(mime: string): boolean {
  return ["image/jpeg", "image/png", "image/webp"].includes(mime.toLowerCase());
}

export function assertUploadSize(size: number): void {
  if (size > MAX_UPLOAD_BYTES) throw new WallpaperError(413, "图片文件不能超过 30 MB。");
}
