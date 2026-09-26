export const TARGET_WIDTH = 976;
export const TARGET_HEIGHT = 596;
export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

export type WallpaperFormat = "gif" | "png" | "jpg" | "webp";
export type WallpaperState = "processing" | "ready" | "failed";
export type WallpaperAsset = "source" | "preview" | "export";

export interface CropRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface WallpaperRecord {
  id: string;
  title: string;
  sourceName: string;
  format: WallpaperFormat;
  width: number;
  height: number;
  frames: number;
  motionPhoto?: boolean;
  motionVideoKey?: string;
  presentationTimestampUs?: number | null;
  crop: CropRect;
  state: WallpaperState;
  error: string | null;
  jobId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WallpaperSummary extends WallpaperRecord {
  outputWidth: number;
  outputHeight: number;
  outputFormat: "gif" | "png" | "jpg";
}

export interface ProcessingJob {
  id: string;
  wallpaperId: string;
  state: "queued" | "running" | "completed" | "failed";
  progress: number;
  message: string;
  error: string | null;
}

export interface UploadResult {
  wallpaper: WallpaperSummary;
  job: ProcessingJob;
}

export interface ImageInfo {
  width: number;
  height: number;
  frames: number;
  loop: number;
  delay?: number[];
}
