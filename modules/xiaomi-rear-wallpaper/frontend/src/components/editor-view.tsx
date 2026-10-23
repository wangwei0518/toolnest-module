import { useId, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import {
  RiDownload2Line,
  RiImageAddLine,
  RiInformationLine,
  RiLoader4Line,
  RiSaveLine,
} from "@remixicon/react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress, ProgressValue } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { deviceProfile } from "@/lib/device-profile";
import type { WallpaperAssetProgress } from "../api";
import { CropEditor } from "./crop-editor";
import { DevicePreview } from "./device-preview";
import type { CropRect, ProcessingJob, WallpaperSummary } from "../types";

export interface WallpaperDraft {
  file: File;
  uploadFile?: File | undefined;
  convertedFromGif?: boolean | undefined;
  importedFromApple?: boolean | undefined;
  url: string;
  motionUrl?: string | undefined;
  motionVideo?: Blob | undefined;
  presentationTimestampUs?: number | null | undefined;
  width: number;
  height: number;
  crop: CropRect;
  saved?: WallpaperSummary;
}

interface EditorViewProps {
  draft: WallpaperDraft | null;
  job: ProcessingJob | null;
  busy: boolean;
  openingSource: boolean;
  sourceProgress: WallpaperAssetProgress | null;
  onRetrySource: (() => void) | undefined;
  error: string;
  message: string;
  encodingProgress: number | null;
  encodingMessage: string;
  onFilesSelected: (files: File[]) => void;
  onCropChange: (crop: CropRect) => void;
  onSave: () => void;
  onDownload: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

function formatLabel(file: File): string {
  return file.type === "image/gif" || file.name.toLowerCase().endsWith(".gif") ? "GIF 动图" : "静态图片";
}

export function EditorView({
  draft,
  job,
  busy,
  openingSource,
  sourceProgress,
  onRetrySource,
  error,
  message,
  encodingProgress,
  encodingMessage,
  onFilesSelected,
  onCropChange,
  onSave,
  onDownload,
}: EditorViewProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const uploadHelpId = useId();
  const isProcessing = job?.state === "queued" || job?.state === "running";

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    if (files.length) onFilesSelected(files);
    event.currentTarget.value = "";
  };
  const dropFile = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length) onFilesSelected(files);
  };

  return (
    <div className="tn-xiaomi-rear-wallpaper__editor-grid">
      <div className="tn-xiaomi-rear-wallpaper__preview-stage">
        <DevicePreview sourceUrl={draft?.url} motionUrl={draft?.motionUrl} crop={draft?.crop} />
      </div>

      <div className="tn-xiaomi-rear-wallpaper__editor-controls">
        {openingSource ? (
          <div className="tn-xiaomi-rear-wallpaper__job-status" role="status" aria-live="polite">
            <span>正在读取原图，完成后即可调整取景…</span>
            {sourceProgress ? <span>已下载 {formatBytes(sourceProgress.loaded)}{sourceProgress.total ? ` / ${formatBytes(sourceProgress.total)}` : ""}</span> : null}
            {sourceProgress?.total ? (
              <Progress
                className="flex-nowrap items-center [&>[data-slot=progress-track]]:order-first [&>[data-slot=progress-track]]:min-w-0 [&>[data-slot=progress-track]]:flex-1"
                aria-label="原图加载进度"
                max={sourceProgress.total}
                value={Math.min(sourceProgress.loaded, sourceProgress.total)}
              >
                <ProgressValue className="shrink-0" />
              </Progress>
            ) : (
              <span className="flex items-center gap-2">
                <RiLoader4Line className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                {sourceProgress ? "正在下载，文件总大小暂不可用" : "正在连接…"}
              </span>
            )}
          </div>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              选择图片
              <TooltipProvider>
                <Tooltip open={helpOpen} onOpenChange={setHelpOpen}>
                  <TooltipTrigger
                    aria-describedby={helpOpen ? uploadHelpId : undefined}
                    onClick={() => setHelpOpen(true)}
                    render={<Button type="button" variant="ghost" size="icon-sm" aria-label="查看支持格式与导入限制" />}
                  >
                    <RiInformationLine />
                  </TooltipTrigger>
                  <TooltipContent id={uploadHelpId} role="tooltip" side="bottom" align="start">
                    支持 JPG、PNG、WebP、GIF、HEIC 和安卓 Live Photo（MVIMG）。苹果实况请同时选择同名的 HEIC/JPG + MOV，或将两个文件一起拖入；每个文件不超过 30 MB，视频最长 15 秒。动态内容统一转为安卓背屏动态照片。
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <input
              ref={fileInputRef}
              className="tn-xiaomi-rear-wallpaper__file-input"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,video/quicktime,.jpg,.jpeg,.png,.webp,.gif,.heic,.heif,.mov"
              multiple
              disabled={busy || isProcessing}
              aria-label="选择壁纸图片"
              onChange={chooseFile}
            />
            <div
              className={`tn-xiaomi-rear-wallpaper__upload-zone${dragging ? " is-dragging" : ""}${draft ? " has-file" : ""}`}
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
              }}
              onDrop={dropFile}
            >
              {draft ? (
                <>
                  <img className="tn-xiaomi-rear-wallpaper__source-thumbnail" src={draft.url} alt="已选图片缩略预览" />
                  <div className="tn-xiaomi-rear-wallpaper__file-summary">
                    <strong title={draft.file.name}>{draft.file.name}</strong>
                    <span>{draft.width} × {draft.height} · {formatBytes(draft.file.size)}</span>
                    <span>{draft.importedFromApple ? "苹果 Live Photo → 安卓背屏动态照片" : draft.convertedFromGif ? "GIF 动图 → 安卓 Live Photo" : draft.motionVideo ? "安卓 Live Photo" : formatLabel(draft.file)}</span>
                  </div>
                  <Button type="button" size="sm" variant="outline" disabled={busy || isProcessing} onClick={() => fileInputRef.current?.click()}>
                    更换图片
                  </Button>
                </>
              ) : (
                <>
                  <span className="tn-xiaomi-rear-wallpaper__upload-icon" aria-hidden="true"><RiImageAddLine /></span>
                  <strong>点击上传图片</strong>
                  <span>或拖入图片 / 苹果实况照片与 MOV 文件</span>
                  <Button type="button" variant="outline" size="sm" disabled={busy || isProcessing} onClick={() => fileInputRef.current?.click()}>
                    选择图片
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="grid gap-4 pt-4">
            <CropEditor
              sourceUrl={draft?.url}
              width={draft?.width ?? 0}
              height={draft?.height ?? 0}
              crop={draft?.crop}
              onCropChange={onCropChange}
            />
            <div className="tn-xiaomi-rear-wallpaper__output-note">
              <span>导出尺寸</span>
              <strong>{deviceProfile.output.width} × {deviceProfile.output.height} px · {deviceProfile.output.densityPpi} PPI</strong>
              <span>{draft?.convertedFromGif ? "GIF 转安卓 Live Photo · JPG + MP4" : draft?.motionVideo ? "导出安卓 Live Photo · JPG + MP4" : draft?.saved?.outputFormat === "gif" ? "旧作品 GIF 动画" : "静态图片导出 PNG"}</span>
            </div>
          </CardContent>
        </Card>

        <div className="lg:hidden"><Button className="w-full" variant="outline" onClick={() => setPreviewOpen(true)}>查看背屏效果</Button><Dialog open={previewOpen} onOpenChange={setPreviewOpen}><DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>背屏效果预览</DialogTitle><DialogDescription>预览当前裁剪在手机背屏上的效果，关闭后继续编辑。</DialogDescription></DialogHeader><div className="mx-auto w-full max-w-56"><DevicePreview sourceUrl={draft?.url} motionUrl={draft?.motionUrl} crop={draft?.crop} /></div></DialogContent></Dialog></div>
        {job ? (
          <div className="tn-xiaomi-rear-wallpaper__job-status" role="status" aria-live="polite">
            <div className="tn-xiaomi-rear-wallpaper__job-copy">
              <span key={`${job.state}:${job.message}`} className="tn-wallpaper-motion-enter">{job.message}</span>
              <span>{job.progress}%</span>
            </div>
            <Progress value={job.progress} aria-label="壁纸生成进度" />
            {job.error ? <p role="alert">{job.error}</p> : null}
          </div>
        ) : null}
        {encodingProgress !== null ? (
          <div className="tn-xiaomi-rear-wallpaper__job-status" role="status" aria-live="polite">
            <div className="tn-xiaomi-rear-wallpaper__job-copy">
              <span>{encodingMessage || "正在编码动态视频"}</span>
              <span>{encodingProgress}%</span>
            </div>
            <Progress value={encodingProgress} aria-label="Live Photo 视频编码进度" />
          </div>
        ) : null}
        {error ? (
          <div className="grid gap-2">
            <p key={error} className="tn-wallpaper-motion-enter tn-xiaomi-rear-wallpaper__feedback is-error" role="alert">{error}</p>
            {onRetrySource ? <Button type="button" variant="outline" disabled={busy} onClick={onRetrySource}>重新读取原图</Button> : null}
          </div>
        ) : null}
        {message ? <p key={message} className="tn-wallpaper-motion-enter tn-xiaomi-rear-wallpaper__feedback" role="status">{message}</p> : null}

        <div className="tn-xiaomi-rear-wallpaper__editor-actions">
          <Button type="button" onClick={onSave} disabled={!draft || busy || isProcessing}>
            <RiSaveLine data-icon="inline-start" />
            {openingSource ? "正在读取…" : busy ? (encodingMessage.includes("GIF") ? "正在转换…" : "正在保存…") : draft?.saved ? "保存取景" : "保存作品"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onDownload}
            disabled={!draft?.saved || draft.saved.state !== "ready" || busy || isProcessing}
          >
            <RiDownload2Line data-icon="inline-start" />下载壁纸
          </Button>
        </div>
      </div>
    </div>
  );
}
