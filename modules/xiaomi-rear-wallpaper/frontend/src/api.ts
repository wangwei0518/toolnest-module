import { getModuleApiClient } from "./api/client";
import type { CropRect, ProcessingJob, UploadResult, WallpaperSummary } from "./types";

// The host-provided module API client already uses `/api/v1` as its base URL.
const base = "/modules/xiaomi-rear-wallpaper";

export function listWallpapers(): Promise<WallpaperSummary[]> {
  return getModuleApiClient().get<WallpaperSummary[]>(`${base}/wallpapers`);
}

export function uploadWallpaper(
  file: File,
  crop: CropRect,
  motionVideo?: Blob,
  presentationTimestampUs?: number | null,
): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("crop", JSON.stringify(crop));
  if (motionVideo) {
    form.append("motionVideo", motionVideo, "motion.mp4");
    if (presentationTimestampUs !== undefined && presentationTimestampUs !== null) {
      form.append("presentationTimestampUs", String(presentationTimestampUs));
    }
  }
  return getModuleApiClient().post<UploadResult>(`${base}/wallpapers`, form);
}

export function updateWallpaperCrop(
  id: string,
  crop: CropRect,
  motionVideo?: Blob,
  presentationTimestampUs?: number | null,
): Promise<UploadResult> {
  const form = new FormData();
  form.append("crop", JSON.stringify(crop));
  if (motionVideo) {
    form.append("motionVideo", motionVideo, "motion.mp4");
    if (presentationTimestampUs !== undefined && presentationTimestampUs !== null) {
      form.append("presentationTimestampUs", String(presentationTimestampUs));
    }
  }
  return getModuleApiClient().put<UploadResult>(`${base}/wallpapers/${encodeURIComponent(id)}/crop`, form);
}

export function getWallpaper(id: string): Promise<WallpaperSummary> {
  return getModuleApiClient().get<WallpaperSummary>(`${base}/wallpapers/${encodeURIComponent(id)}`);
}

export function getWallpaperJob(jobId: string): Promise<ProcessingJob> {
  return getModuleApiClient().get<ProcessingJob>(`${base}/jobs/${encodeURIComponent(jobId)}`);
}

export function getWallpaperAsset(id: string, asset: "source" | "preview" | "export"): Promise<Blob> {
  return getModuleApiClient().get<Blob>(
    `${base}/wallpapers/${encodeURIComponent(id)}/${asset}`,
    { responseType: "blob" },
  );
}

export function deleteWallpaper(id: string): Promise<void> {
  return getModuleApiClient().delete<void>(`${base}/wallpapers/${encodeURIComponent(id)}`);
}
