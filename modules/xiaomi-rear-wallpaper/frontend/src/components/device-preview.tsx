import { useEffect, useRef, useState } from "react";

import { deviceProfile } from "@/lib/device-profile";
import type { CropRect } from "../types";

const referenceAssetName = "xiaomi-rear-display-reference.png";
const phoneReference = import.meta.env.DEV
  ? `/${referenceAssetName}`
  : new URL(`./${referenceAssetName}`, import.meta.url).href;

const { width: frameWidth, height: frameHeight, display: displayRegion } = deviceProfile.reference;
const display = {
  left: (displayRegion.left / frameWidth) * 100,
  top: (displayRegion.top / frameHeight) * 100,
  width: (displayRegion.width / frameWidth) * 100,
  height: (displayRegion.height / frameHeight) * 100,
};

interface DevicePreviewProps {
  sourceUrl?: string | undefined;
  motionUrl?: string | undefined;
  crop?: CropRect | undefined;
  alt?: string;
}

function removeDisplayWhite(image: HTMLImageElement, canvas: HTMLCanvasElement): void {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return;
  canvas.width = frameWidth;
  canvas.height = frameHeight;
  context.drawImage(image, 0, 0, frameWidth, frameHeight);
  const frame = context.getImageData(0, 0, frameWidth, frameHeight);
  const pixels = frame.data;
  const queue = new Uint32Array(frameWidth * frameHeight);
  const xMin = Math.max(0, displayRegion.left - 28);
  const xMax = Math.min(frameWidth - 1, displayRegion.left + displayRegion.width + 28);
  const yMin = Math.max(0, displayRegion.top - 28);
  const yMax = Math.min(frameHeight - 1, displayRegion.top + displayRegion.height + 30);
  const seedX = Math.round(displayRegion.left + displayRegion.width / 2);
  const seedY = displayRegion.top + 32;
  let read = 0;
  let write = 0;

  const enqueueIfDisplay = (x: number, y: number) => {
    if (x < xMin || x > xMax || y < yMin || y > yMax) return;
    const index = (y * frameWidth + x) * 4;
    if ((pixels[index + 3] ?? 0) === 0) return;
    const red = pixels[index] ?? 0;
    const green = pixels[index + 1] ?? 0;
    const blue = pixels[index + 2] ?? 0;
    if (red < 185 || green < 185 || blue < 185) return;
    if (Math.max(red, green, blue) - Math.min(red, green, blue) > 24) return;
    pixels[index + 3] = 0;
    queue[write++] = y * frameWidth + x;
  };

  enqueueIfDisplay(seedX, seedY);
  while (read < write) {
    const pixel = queue[read++] ?? 0;
    const x = pixel % frameWidth;
    const y = Math.floor(pixel / frameWidth);
    enqueueIfDisplay(x - 1, y);
    enqueueIfDisplay(x + 1, y);
    enqueueIfDisplay(x, y - 1);
    enqueueIfDisplay(x, y + 1);
  }
  context.putImageData(frame, 0, 0);
}

function DisplayOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const image = new Image();
    let active = true;
    // The runtime module is served from its own Vite origin during HMR.
    // Request CORS access before setting src so the display can be cleared
    // from the canvas without tainting it and hiding the whole device overlay.
    image.crossOrigin = "anonymous";
    image.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas || !active) return;
      removeDisplayWhite(image, canvas);
      setReady(true);
    };
    image.src = phoneReference;
    return () => {
      active = false;
      image.onload = null;
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="tn-xiaomi-rear-wallpaper__device-overlay"
      width={frameWidth}
      height={frameHeight}
      data-ready={ready}
      aria-hidden="true"
    />
  );
}

export function DevicePreview({ sourceUrl, motionUrl, crop, alt = "壁纸在小米背屏上的预览" }: DevicePreviewProps) {
  const cropStyle = crop
    ? {
        width: `${100 / crop.width}%`,
        height: `${100 / crop.height}%`,
        left: `${(-crop.left / crop.width) * 100}%`,
        top: `${(-crop.top / crop.height) * 100}%`,
      }
    : undefined;

  return (
    <div
      className="tn-xiaomi-rear-wallpaper__device-scene"
      style={{ aspectRatio: `${frameWidth} / ${frameHeight}` }}
      role="img"
      aria-label={alt}
    >
      <div
        className="tn-xiaomi-rear-wallpaper__device-screen"
        style={{
          left: `${display.left}%`,
          top: `${display.top}%`,
          width: `${display.width}%`,
          height: `${display.height}%`,
        }}
      >
        {motionUrl ? (
          <video
            className="tn-xiaomi-rear-wallpaper__device-wallpaper"
            src={motionUrl}
            poster={sourceUrl}
            muted
            autoPlay
            loop
            playsInline
            preload="metadata"
            aria-hidden="true"
            style={cropStyle}
          />
        ) : sourceUrl ? (
          <img
            className="tn-xiaomi-rear-wallpaper__device-wallpaper"
            src={sourceUrl}
            alt=""
            draggable={false}
            style={cropStyle}
          />
        ) : (
          <div className="tn-xiaomi-rear-wallpaper__device-empty" />
        )}
      </div>
      <DisplayOverlay />
    </div>
  );
}
