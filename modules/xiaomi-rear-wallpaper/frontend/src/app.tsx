import { useEffect, useState } from "react";
import type { ToolNestModuleRouteRenderProps } from "@toolnest/react-module-sdk";

import { getWallpaper, getWallpaperAsset, getWallpaperJob, updateWallpaperCrop, uploadWallpaper } from "./api";
import { EditorView, type WallpaperDraft } from "./components/editor-view";
import { GalleryView } from "./components/gallery-view";
import { ModuleLayout, type ModuleView } from "./components/module-layout";
import { errorMessage } from "./lib/error-message";
import { initialCrop } from "./lib/crop";
import { convertGifToMotionPhoto, createCroppedMotionVideo, extractEmbeddedMotionPhoto } from "./lib/motion-photo";
import type { CropRect, ProcessingJob, WallpaperFormat, WallpaperSummary } from "./types";

const maximumUploadSize = 30 * 1024 * 1024;
const acceptedTypes: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  png: "image/png",
  webp: "image/webp",
};

function extensionOf(filename: string): string {
  return filename.split(".").at(-1)?.toLowerCase() ?? "";
}

function formatOf(record: WallpaperSummary): WallpaperFormat {
  return record.format;
}

function readImageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("无法读取图片，请检查文件是否损坏。"));
    image.src = url;
  });
}

function mimeFor(format: WallpaperFormat): string {
  return format === "jpg" ? "image/jpeg" : `image/${format}`;
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ModuleApp(_props: ToolNestModuleRouteRenderProps) {
  const [view, setView] = useState<ModuleView>("editor");
  const [draft, setDraft] = useState<WallpaperDraft | null>(null);
  const [job, setJob] = useState<ProcessingJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [encodingProgress, setEncodingProgress] = useState<number | null>(null);
  const [encodingMessage, setEncodingMessage] = useState("");
  const [galleryRefreshKey, setGalleryRefreshKey] = useState(0);

  const draftUrl = draft?.url;
  const draftMotionUrl = draft?.motionUrl;
  useEffect(() => {
    if (!draftUrl) return;
    return () => {
      URL.revokeObjectURL(draftUrl);
      if (draftMotionUrl) URL.revokeObjectURL(draftMotionUrl);
    };
  }, [draftMotionUrl, draftUrl]);

  useEffect(() => {
    if (!job || (job.state !== "queued" && job.state !== "running")) return;
    let active = true;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const next = await getWallpaperJob(job.id);
        if (!active) return;
        setJob(next);
        if (next.state === "completed") {
          const saved = await getWallpaper(next.wallpaperId);
          if (!active) return;
          setDraft((current) => current?.saved?.id === saved.id ? { ...current, saved } : current);
          setMessage("作品已保存，壁纸可以下载了。");
          setError("");
          setGalleryRefreshKey((value) => value + 1);
          return;
        }
        if (next.state === "failed") {
          setError(next.error ?? "图片生成失败，请调整裁切后重试。");
          setGalleryRefreshKey((value) => value + 1);
          return;
        }
        timer = window.setTimeout(() => void poll(), 700);
      } catch (reason) {
        if (!active) return;
        setError(errorMessage(reason, "读取生成进度失败，请重试。"));
        timer = window.setTimeout(() => void poll(), 1800);
      }
    };
    void poll();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [job?.id]);

  const onFileSelected = async (selected: File) => {
    setError("");
    setMessage("");
    setJob(null);
    if (selected.size > maximumUploadSize) {
      setError("图片文件不能超过 30 MB。");
      return;
    }
    const extension = extensionOf(selected.name);
    const mime = selected.type || acceptedTypes[extension] || "";
    if (!Object.values(acceptedTypes).includes(mime) || !acceptedTypes[extension]) {
      setError("请选择 JPG、PNG、WebP、GIF，或包含 MP4 视频的安卓 Live Photo JPG。");
      return;
    }
    const file = selected.type ? selected : new File([selected], selected.name, { type: mime });
    const url = URL.createObjectURL(file);
    let motionUrl: string | undefined;
    setBusy(true);
    try {
      let uploadFile = file;
      let motionVideo: Blob | undefined;
      let presentationTimestampUs: number | null | undefined;
      let size: { width: number; height: number };
      const convertedFromGif = mime === "image/gif";
      if (convertedFromGif) {
        setEncodingMessage("正在将 GIF 转换为安卓 Live Photo");
        setEncodingProgress(0);
        const conversion = await convertGifToMotionPhoto(file, (progress) => {
          setEncodingProgress(Math.round(progress * 100));
        });
        uploadFile = conversion.sourceFile;
        motionVideo = conversion.video;
        presentationTimestampUs = 0;
        size = { width: conversion.width, height: conversion.height };
        motionUrl = URL.createObjectURL(conversion.video);
      } else {
        const motion = mime === "image/jpeg" ? await extractEmbeddedMotionPhoto(file) : null;
        size = await readImageSize(url);
        motionVideo = motion?.video;
        presentationTimestampUs = motion?.presentationTimestampUs;
        if (motion) motionUrl = URL.createObjectURL(motion.video);
      }
      const crop = initialCrop(size.width, size.height);
      setDraft({
        file,
        uploadFile,
        convertedFromGif,
        url,
        motionUrl,
        motionVideo,
        presentationTimestampUs,
        width: size.width,
        height: size.height,
        crop,
      });
      if (convertedFromGif) setMessage("GIF 已转换为动态照片。预览会循环播放；手机图库中的播放与循环方式由系统控制。");
    } catch (reason) {
      URL.revokeObjectURL(url);
      if (motionUrl) URL.revokeObjectURL(motionUrl);
      setError(errorMessage(reason, "无法打开这张图片。"));
    } finally {
      setBusy(false);
      setEncodingProgress(null);
      setEncodingMessage("");
    }
  };

  const onSave = async () => {
    if (!draft) return;
    setBusy(true);
    setError("");
    setMessage("");
    setEncodingProgress(null);
    setEncodingMessage(draft.motionVideo ? "正在裁切并编码动态视频" : "");
    try {
      const motionVideo = draft.motionVideo
        ? await createCroppedMotionVideo(draft.motionVideo, draft.crop, (progress) => {
            setEncodingProgress(Math.round(progress * 100));
          })
        : undefined;
      setEncodingProgress(null);
      const result = draft.saved
        ? await updateWallpaperCrop(draft.saved.id, draft.crop, motionVideo, draft.presentationTimestampUs)
        : await uploadWallpaper(draft.uploadFile ?? draft.file, draft.crop, motionVideo, draft.presentationTimestampUs);
      setDraft((current) => current ? { ...current, saved: result.wallpaper } : current);
      setJob(result.job);
      setGalleryRefreshKey((value) => value + 1);
      setMessage(result.job.state === "completed" ? "作品已保存。" : "已保存，正在生成壁纸…");
    } catch (reason) {
      setError(errorMessage(reason, "保存失败，请稍后重试。"));
    } finally {
      setBusy(false);
      setEncodingProgress(null);
      setEncodingMessage("");
    }
  };

  const onDownload = async () => {
    if (!draft?.saved || draft.saved.state !== "ready") return;
    setBusy(true);
    setError("");
    try {
      const blob = await getWallpaperAsset(draft.saved.id, "export");
      const extension = draft.saved.outputFormat;
      const stem = draft.saved.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 80) || "背屏壁纸";
      saveBlob(blob, `${stem}.${extension}`);
    } catch (reason) {
      setError(errorMessage(reason, "下载失败，请稍后重试。"));
    } finally {
      setBusy(false);
    }
  };

  const onEdit = async (wallpaper: WallpaperSummary) => {
    setBusy(true);
    setError("");
    setMessage("");
    let sourceUrl: string | undefined;
    let motionUrl: string | undefined;
    try {
      const blob = await getWallpaperAsset(wallpaper.id, "source");
      const file = new File([blob], wallpaper.sourceName, { type: mimeFor(formatOf(wallpaper)) });
      sourceUrl = URL.createObjectURL(file);
      const motion = wallpaper.motionPhoto ? await extractEmbeddedMotionPhoto(file) : null;
      if (wallpaper.motionPhoto && !motion) {
        throw new Error("原作品中没有找到 Live Photo 视频，请重新上传原始动态照片。");
      }
      if (motion) motionUrl = URL.createObjectURL(motion.video);
      setDraft({
        file,
        url: sourceUrl,
        motionUrl,
        motionVideo: motion?.video,
        presentationTimestampUs: motion?.presentationTimestampUs ?? wallpaper.presentationTimestampUs,
        width: wallpaper.width,
        height: wallpaper.height,
        crop: wallpaper.crop,
        saved: wallpaper,
      });
      setJob(null);
      setView("editor");
    } catch (reason) {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
      if (motionUrl) URL.revokeObjectURL(motionUrl);
      setError(errorMessage(reason, "原图读取失败，请稍后重试。"));
    } finally {
      setBusy(false);
    }
  };

  const refreshGallery = () => setGalleryRefreshKey((value) => value + 1);

  return (
    <ModuleLayout view={view} onViewChange={setView}>
      {view === "editor" ? (
        <EditorView
          draft={draft}
          job={job}
          busy={busy}
          error={error}
          message={message}
          encodingProgress={encodingProgress}
          encodingMessage={encodingMessage}
          onFileSelected={(file) => void onFileSelected(file)}
          onCropChange={(crop: CropRect) => setDraft((current) => current ? { ...current, crop } : current)}
          onSave={() => void onSave()}
          onDownload={() => void onDownload()}
        />
      ) : (
        <GalleryView refreshKey={galleryRefreshKey} onRefresh={refreshGallery} onEdit={(wallpaper) => void onEdit(wallpaper)} />
      )}
    </ModuleLayout>
  );
}
