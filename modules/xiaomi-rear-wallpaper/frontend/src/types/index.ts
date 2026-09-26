export interface CropRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type WallpaperFormat = "gif" | "png" | "jpg" | "webp";
export type WallpaperState = "processing" | "ready" | "failed";

export interface WallpaperSummary {
  id: string;
  title: string;
  sourceName: string;
  format: WallpaperFormat;
  width: number;
  height: number;
  frames: number;
  motionPhoto?: boolean;
  presentationTimestampUs?: number | null;
  crop: CropRect;
  state: WallpaperState;
  error: string | null;
  jobId: string | null;
  createdAt: string;
  updatedAt: string;
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
