import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { RiRestartLine, RiZoomInLine, RiZoomOutLine } from "@remixicon/react";

import { initialCrop, cropZoom, panCrop, zoomCrop } from "@/lib/crop";
import { deviceProfile } from "@/lib/device-profile";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import type { CropRect } from "../types";

interface CropEditorProps {
  sourceUrl?: string | undefined;
  width: number;
  height: number;
  crop?: CropRect | undefined;
  onCropChange: (crop: CropRect) => void;
}

export function CropEditor({ sourceUrl, width, height, crop, onCropChange }: CropEditorProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const dragPoint = useRef<{ x: number; y: number } | undefined>(undefined);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const activeCrop = crop ?? (width > 0 && height > 0 ? initialCrop(width, height) : undefined);
  const zoom = useMemo(
    () => (activeCrop && width > 0 && height > 0 ? cropZoom(width, height, activeCrop) : 1),
    [activeCrop, height, width],
  );

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const imageStyle = activeCrop
    ? {
        width: `${100 / activeCrop.width}%`,
        height: `${100 / activeCrop.height}%`,
        left: `${(-activeCrop.left / activeCrop.width) * 100}%`,
        top: `${(-activeCrop.top / activeCrop.height) * 100}%`,
      }
    : undefined;

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!activeCrop) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragPoint.current = { x: event.clientX, y: event.clientY };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragPoint.current || !activeCrop) return;
    const deltaX = event.clientX - dragPoint.current.x;
    const deltaY = event.clientY - dragPoint.current.y;
    dragPoint.current = { x: event.clientX, y: event.clientY };
    onCropChange(panCrop(activeCrop, deltaX, deltaY, stageSize.width, stageSize.height));
  };

  const setZoom = (value: number) => {
    if (width > 0 && height > 0 && activeCrop) {
      onCropChange(zoomCrop(width, height, activeCrop, value));
    }
  };

  return (
    <section className="tn-xiaomi-rear-wallpaper__crop-workspace" aria-label="裁剪与调整">
      <div className="tn-xiaomi-rear-wallpaper__section-heading">
        <h2>裁剪与调整</h2>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => width > 0 && height > 0 && onCropChange(initialCrop(width, height))}
          disabled={!sourceUrl}
        >
          <RiRestartLine data-icon="inline-start" />
          恢复默认
        </Button>
      </div>
      <div
        ref={stageRef}
        className={`tn-xiaomi-rear-wallpaper__crop-stage${sourceUrl ? " is-editable" : ""}`}
        style={{ aspectRatio: `${deviceProfile.output.width} / ${deviceProfile.output.height}` }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={() => { dragPoint.current = undefined; }}
        onPointerCancel={() => { dragPoint.current = undefined; }}
        role={sourceUrl ? "group" : undefined}
        tabIndex={sourceUrl ? 0 : undefined}
        aria-label={sourceUrl ? "拖动图片调整背屏取景范围" : undefined}
        aria-describedby={sourceUrl ? "wallpaper-crop-help" : undefined}
        onKeyDown={(event) => {
          if (!activeCrop || !sourceUrl) return;
          const movement = 12;
          const direction = {
            ArrowLeft: [-movement, 0],
            ArrowRight: [movement, 0],
            ArrowUp: [0, -movement],
            ArrowDown: [0, movement],
          }[event.key];
          if (!direction) return;
          event.preventDefault();
          onCropChange(panCrop(activeCrop, direction[0] ?? 0, direction[1] ?? 0, stageSize.width, stageSize.height));
        }}
      >
        {sourceUrl && imageStyle ? (
          <img className="tn-xiaomi-rear-wallpaper__crop-image" src={sourceUrl} alt="" draggable={false} style={imageStyle} />
        ) : (
          <span className="tn-xiaomi-rear-wallpaper__crop-empty">上传图片后在此调整取景</span>
        )}
        {sourceUrl ? <div className="tn-xiaomi-rear-wallpaper__crop-grid" aria-hidden="true" /> : null}
      </div>
      <p id="wallpaper-crop-help" className="tn-xiaomi-rear-wallpaper__help-text">
        {sourceUrl ? "拖动图片调整取景，镜头区域会在设备预览中自动保留。" : "自动填满背屏比例，可拖动和缩放调整画面。"}
      </p>
      <div className="tn-xiaomi-rear-wallpaper__zoom-control">
        <RiZoomOutLine aria-hidden="true" />
        <label id="wallpaper-zoom-label">缩放</label>
        <Slider
          id="wallpaper-zoom"
          aria-labelledby="wallpaper-zoom-label"
          className="tn-xiaomi-rear-wallpaper__zoom-slider"
          min={1}
          max={4}
          step={0.01}
          value={[zoom]}
          disabled={!sourceUrl}
          onValueChange={(value) => setZoom(typeof value === "number" ? value : (value[0] ?? 1))}
        />
        <output htmlFor="wallpaper-zoom">{zoom.toFixed(1)}×</output>
        <RiZoomInLine aria-hidden="true" />
      </div>
    </section>
  );
}
