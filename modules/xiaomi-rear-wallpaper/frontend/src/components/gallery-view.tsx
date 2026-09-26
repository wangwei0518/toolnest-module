import { useEffect, useState } from "react";
import { RiDeleteBinLine, RiDownload2Line, RiEditLine, RiImageLine, RiRefreshLine } from "@remixicon/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { confirmInHost } from "@/lib/module-actions";
import { deviceProfile } from "@/lib/device-profile";
import { errorMessage } from "@/lib/error-message";
import { deleteWallpaper, getWallpaperAsset, listWallpapers } from "../api";
import type { WallpaperSummary } from "../types";

interface GalleryViewProps {
  refreshKey: number;
  onRefresh: () => void;
  onEdit: (wallpaper: WallpaperSummary) => void;
}

function outputLabel(item: WallpaperSummary): string {
  const format = item.motionPhoto ? "安卓 Live Photo" : item.outputFormat === "gif" ? "GIF 动图" : "PNG 图片";
  return `${item.outputWidth} × ${item.outputHeight} · ${format}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(value));
}

function downloadName(item: WallpaperSummary): string {
  const safeTitle = item.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 80) || "背屏壁纸";
  return `${safeTitle}.${item.outputFormat}`;
}

export function GalleryView({ refreshKey, onRefresh, onEdit }: GalleryViewProps) {
  const [items, setItems] = useState<WallpaperSummary[]>([]);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionId, setActionId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const urls = new Set<string>();
    setLoading(true);
    setError("");
    void listWallpapers()
      .then(async (records) => {
        if (!active) return;
        setItems(records);
        const entries = await Promise.all(records
          .filter((record) => record.state === "ready")
          .map(async (record) => {
            try {
              const blob = await getWallpaperAsset(record.id, "preview");
              const url = URL.createObjectURL(blob);
              urls.add(url);
              return [record.id, url] as const;
            } catch {
              return null;
            }
          }));
        if (active) setPreviewUrls(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry !== null)));
        else urls.forEach((url) => URL.revokeObjectURL(url));
      })
      .catch((reason: unknown) => {
        if (active) setError(errorMessage(reason, "作品列表加载失败，请重试。"));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => {
      active = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [refreshKey]);

  const download = async (item: WallpaperSummary) => {
    setActionId(item.id);
    setError("");
    try {
      const blob = await getWallpaperAsset(item.id, "export");
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = downloadName(item);
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) {
      setError(errorMessage(reason, "下载失败，请稍后重试。"));
    } finally {
      setActionId(null);
    }
  };

  const remove = async (item: WallpaperSummary) => {
    const confirmed = await confirmInHost({
      title: "删除这张壁纸？",
      content: "删除后会同时移除原图和生成文件，无法恢复。",
    });
    if (!confirmed) return;
    setActionId(item.id);
    setError("");
    try {
      await deleteWallpaper(item.id);
      setItems((current) => current.filter((record) => record.id !== item.id));
      setPreviewUrls((current) => {
        const url = current[item.id];
        if (url) URL.revokeObjectURL(url);
        const next = { ...current };
        delete next[item.id];
        return next;
      });
    } catch (reason) {
      setError(errorMessage(reason, "删除失败，请稍后重试。"));
    } finally {
      setActionId(null);
    }
  };

  return (
    <section className="tn-xiaomi-rear-wallpaper__gallery" aria-label="我的壁纸作品">
      <div className="tn-xiaomi-rear-wallpaper__gallery-heading">
        <div>
          <h2>我的作品</h2>
          <p>已保存 {items.length} 张壁纸</p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={onRefresh} disabled={loading}>
          <RiRefreshLine data-icon="inline-start" />刷新
        </Button>
      </div>

      {error ? <p className="tn-xiaomi-rear-wallpaper__feedback is-error" role="alert">{error}</p> : null}
      {loading ? <p className="tn-xiaomi-rear-wallpaper__gallery-state" role="status">正在加载作品…</p> : null}
      {!loading && items.length === 0 ? (
        <div className="tn-xiaomi-rear-wallpaper__gallery-empty">
          <RiImageLine aria-hidden="true" />
          <h3>还没有保存的作品</h3>
          <p>选择一张图片，调整取景并保存后就会出现在这里。</p>
        </div>
      ) : null}
      <div className="tn-xiaomi-rear-wallpaper__gallery-grid">
        {items.map((item) => (
          <Card key={item.id} className="tn-xiaomi-rear-wallpaper__gallery-item">
            {previewUrls[item.id] ? (
              <img
                className="tn-xiaomi-rear-wallpaper__gallery-preview"
                src={previewUrls[item.id]}
                alt={`${item.title}壁纸预览`}
                style={{ aspectRatio: `${deviceProfile.output.width} / ${deviceProfile.output.height}` }}
              />
            ) : (
              <div
                className="tn-xiaomi-rear-wallpaper__gallery-preview tn-xiaomi-rear-wallpaper__gallery-preview--empty"
                style={{ aspectRatio: `${deviceProfile.output.width} / ${deviceProfile.output.height}` }}
                aria-hidden="true"
              >
                {item.state === "processing" ? "正在生成…" : "预览暂不可用"}
              </div>
            )}
            <CardHeader className="tn-xiaomi-rear-wallpaper__gallery-card-header">
              <CardTitle title={item.title}>{item.title}</CardTitle>
              <Badge variant={item.motionPhoto || item.format === "gif" ? "secondary" : "outline"}>
                {item.motionPhoto ? "Live Photo" : item.format === "gif" ? "GIF 动图" : "静态图片"}
              </Badge>
            </CardHeader>
            <CardContent className="tn-xiaomi-rear-wallpaper__gallery-meta">
              <span>{outputLabel(item)}</span>
              <span>{formatDate(item.updatedAt)}</span>
              {item.error ? <span className="text-destructive">{item.error}</span> : null}
            </CardContent>
            <CardFooter className="tn-xiaomi-rear-wallpaper__gallery-actions">
              <Button type="button" size="sm" onClick={() => onEdit(item)} disabled={item.state === "processing" || actionId === item.id}>
                <RiEditLine data-icon="inline-start" />编辑
              </Button>
              <Button type="button" size="icon-sm" variant="outline" aria-label={`下载${item.title}`} disabled={item.state !== "ready" || actionId === item.id} onClick={() => void download(item)}>
                <RiDownload2Line />
              </Button>
              <Button type="button" size="icon-sm" variant="ghost" aria-label={`删除${item.title}`} disabled={actionId === item.id} onClick={() => void remove(item)}>
                <RiDeleteBinLine />
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </section>
  );
}
