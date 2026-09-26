import type { CropRect } from "../types";
import { deviceProfile } from "./device-profile";

export const TARGET_WIDTH = deviceProfile.output.width;
export const TARGET_HEIGHT = deviceProfile.output.height;
const targetRatio = deviceProfile.output.width / deviceProfile.output.height;

export function initialCrop(width: number, height: number): CropRect {
  const ratio = width / height;
  if (ratio > targetRatio) {
    const cropWidth = (targetRatio * height) / width;
    return { left: (1 - cropWidth) / 2, top: 0, width: cropWidth, height: 1 };
  }
  const cropHeight = width / targetRatio / height;
  return { left: 0, top: (1 - cropHeight) / 2, width: 1, height: cropHeight };
}

function clampPosition(position: number, size: number): number {
  return Math.min(1 - size, Math.max(0, position));
}

export function zoomCrop(
  width: number,
  height: number,
  current: CropRect,
  zoom: number,
): CropRect {
  const base = initialCrop(width, height);
  const cropWidth = base.width / zoom;
  const cropHeight = base.height / zoom;
  const centerX = current.left + current.width / 2;
  const centerY = current.top + current.height / 2;
  return {
    left: clampPosition(centerX - cropWidth / 2, cropWidth),
    top: clampPosition(centerY - cropHeight / 2, cropHeight),
    width: cropWidth,
    height: cropHeight,
  };
}

export function panCrop(
  current: CropRect,
  deltaX: number,
  deltaY: number,
  stageWidth: number,
  stageHeight: number,
): CropRect {
  if (stageWidth <= 0 || stageHeight <= 0) return current;
  const imageWidth = stageWidth / current.width;
  const imageHeight = stageHeight / current.height;
  return {
    ...current,
    left: clampPosition(current.left - deltaX / imageWidth, current.width),
    top: clampPosition(current.top - deltaY / imageHeight, current.height),
  };
}

export function cropZoom(width: number, height: number, crop: CropRect): number {
  const base = initialCrop(width, height);
  return Math.max(1, base.width / crop.width);
}
