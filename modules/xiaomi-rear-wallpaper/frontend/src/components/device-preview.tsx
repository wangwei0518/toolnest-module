import { deviceProfile } from "@/lib/device-profile";
import phoneFrame from "../assets/xiaomi-rear-display-frame.png?url&inline";
import type { CropRect } from "../types";

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
            key={motionUrl || sourceUrl}
            className="tn-wallpaper-motion-enter tn-xiaomi-rear-wallpaper__device-wallpaper"
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
            key={motionUrl || sourceUrl}
            className="tn-wallpaper-motion-enter tn-xiaomi-rear-wallpaper__device-wallpaper"
            src={sourceUrl}
            alt=""
            draggable={false}
            style={cropStyle}
          />
        ) : (
          <div className="tn-xiaomi-rear-wallpaper__device-empty" />
        )}
      </div>
      <img
        className="tn-xiaomi-rear-wallpaper__device-overlay"
        src={phoneFrame}
        width={frameWidth}
        height={frameHeight}
        alt=""
        aria-hidden="true"
        draggable={false}
        decoding="sync"
        loading="eager"
      />
    </div>
  );
}
