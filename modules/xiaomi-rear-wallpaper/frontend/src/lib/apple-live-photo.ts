import { packageMotionPhoto } from "./motion-photo";

const maximumFileSize = 30 * 1024 * 1024;
const maximumVideoSide = 1440;
class AppleLivePhotoError extends Error {}

const imageTypes: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  gif: "image/gif", heic: "image/heic", heif: "image/heif",
};

function extension(file: File): string {
  return file.name.split(".").at(-1)?.toLowerCase() ?? "";
}

export function isHeicPhoto(file: File): boolean {
  return ["heic", "heif"].includes(extension(file));
}

export function selectPhotoFiles(files: readonly File[]): { image: File; video?: File } {
  if (files.length < 1 || files.length > 2) {
    throw new Error("请选择一张图片，或同时选择一组同名的 HEIC/JPG 和 MOV 苹果 Live Photo 文件。");
  }
  if (files.some((file) => file.size > maximumFileSize)) throw new Error("每个图片或视频文件不能超过 30 MB。");
  const image = files.find((file) => imageTypes[extension(file)]);
  const video = files.find((file) => extension(file) === "mov");
  if (!image) throw new Error("请选择 JPG、PNG、WebP、GIF、HEIC 图片；苹果 Live Photo 需同时选择照片和 MOV 视频。");
  if (files.length === 2) {
    if (!video || !["jpg", "jpeg", "heic", "heif"].includes(extension(image))) {
      throw new Error("苹果 Live Photo 需要一张 HEIC/JPG 照片和一个 MOV 视频，不能同时导入多张图片。");
    }
    const stem = (file: File) => file.name.replace(/\.[^.]+$/, "").normalize("NFC").toLowerCase();
    if (stem(image) !== stem(video)) throw new Error("照片和 MOV 文件名必须相同（扩展名除外），请确认它们来自同一张 Live Photo。");
  }
  const normalizedImage = new File([image], image.name, { type: imageTypes[extension(image)] ?? image.type, lastModified: image.lastModified });
  return video ? { image: normalizedImage, video } : { image: normalizedImage };
}

export async function convertHeicPhoto(file: File): Promise<File> {
  try {
    const { heicTo } = await import("heic-to/csp");
    const jpeg = await heicTo({ blob: file, type: "image/jpeg", quality: 0.92 });
    return new File([jpeg], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" });
  } catch {
    throw new Error("无法解码这张 HEIC 照片，请从照片应用导出 JPG 后，与配套 MOV 一起选择。");
  }
}

async function matchPhotoToVideo(photo: Blob, width: number, height: number, ratio: number): Promise<{ jpeg: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(photo);
  try {
    const cropWidth = Math.min(width, height * ratio);
    const cropHeight = Math.min(height, width / ratio);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(2, Math.floor(cropWidth / 2) * 2);
    canvas.height = Math.max(2, Math.floor(cropHeight / 2) * 2);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new AppleLivePhotoError("浏览器无法处理实况照片画面。");
    context.drawImage(bitmap, (width - cropWidth) / 2, (height - cropHeight) / 2, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
    const jpeg = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new AppleLivePhotoError("无法转换实况照片画面。")), "image/jpeg", 0.92);
    });
    return { jpeg, width: canvas.width, height: canvas.height };
  } finally {
    bitmap.close();
  }
}

/** Normalize the paired Apple resources to the same embedded source used by existing edits. */
export async function convertAppleLivePhoto(
  image: File,
  video: File,
  onProgress: (progress: number) => void,
): Promise<{ sourceFile: File; video: Blob; width: number; height: number; photoCropped: boolean }> {
  let jpeg: Blob = isHeicPhoto(image) ? await convertHeicPhoto(image) : image;
  const bitmap = await createImageBitmap(jpeg).catch(() => {
    throw new Error("无法读取实况照片，请确认 JPG/HEIC 文件完整且未损坏。");
  });
  let { width, height } = bitmap;
  bitmap.close();
  if (!width || !height || width * height > 100_000_000) throw new Error("照片像素量过大，请缩小照片后重试。");
  const { ALL_FORMATS, BlobSource, Input, Output, BufferTarget, Mp4OutputFormat, Conversion, Quality, canEncodeVideo } = await import("mediabunny");
  const input = new Input({ source: new BlobSource(video), formats: ALL_FORMATS });
  let output: InstanceType<typeof Output> | undefined;
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new AppleLivePhotoError("MOV 中没有找到视频轨道，请选择原始 Live Photo 配套视频。");
    if (!await track.canDecode()) throw new AppleLivePhotoError("当前浏览器无法解码该 MOV 视频（可能为 HEVC/H.265），请使用支持此编码的 Chrome/Edge，或先将视频转换为 H.264 MOV。");
    const [videoWidth, videoHeight, duration] = await Promise.all([track.getDisplayWidth(), track.getDisplayHeight(), track.computeDuration()]);
    if (!Number.isFinite(duration) || duration <= 0 || duration > 15) throw new AppleLivePhotoError("苹果 Live Photo 视频时长需要在 0 到 15 秒之间。");
    if (!videoWidth || !videoHeight) throw new AppleLivePhotoError("MOV 视频画面尺寸无效。");
    const ratioDifference = Math.abs((videoWidth / videoHeight) / (width / height) - 1);
    const photoCropped = ratioDifference > 0.002;
    if (photoCropped) {
      const matched = await matchPhotoToVideo(jpeg, width, height, videoWidth / videoHeight);
      jpeg = matched.jpeg;
      width = matched.width;
      height = matched.height;
    }
    const scale = Math.min(1, maximumVideoSide / Math.max(width, height));
    const outputWidth = Math.max(2, Math.round(width * scale / 2) * 2);
    const outputHeight = Math.max(2, Math.round(height * scale / 2) * 2);
    const quality = new Quality("high");
    if (!await canEncodeVideo("avc", { width: outputWidth, height: outputHeight, quality, frameRate: 30 })) {
      throw new AppleLivePhotoError("当前浏览器不支持 H.264 视频编码，请使用支持 WebCodecs 的 Chrome 或 Edge。");
    }
    const target = new BufferTarget();
    output = new Output({ target, format: new Mp4OutputFormat({ fastStart: "in-memory" }) });
    const conversion = await Conversion.init({
      input, output, tracks: "primary", copy: false,
      video: { codec: "avc", quality, width: outputWidth, height: outputHeight, fit: "fill", frameRate: 30, forceTranscode: true, allowTransformationMetadata: false },
      audio: { discard: true }, showWarnings: false,
    });
    if (!conversion.isValid) throw new AppleLivePhotoError("这段 MOV 视频无法转换，请重新导出原始 Live Photo。");
    conversion.onProgress = onProgress;
    await conversion.execute();
    if (!target.buffer?.byteLength) throw new AppleLivePhotoError("MOV 转换没有生成有效视频。");
    const normalizedVideo = new Blob([target.buffer], { type: "video/mp4" });
    if (normalizedVideo.size > maximumFileSize) throw new AppleLivePhotoError("转换后的视频超过 30 MB，请缩短视频或降低分辨率。");
    // Apple still-image-time is not inferred from duration. Keep the supplied photo as the still.
    const sourceFile = packageMotionPhoto(jpeg, normalizedVideo, image.name, null);
    if (sourceFile.size > maximumFileSize) throw new AppleLivePhotoError("转换后的动态照片超过 30 MB，请缩小照片或视频后重试。");
    return { sourceFile, video: normalizedVideo, width, height, photoCropped };
  } catch (error) {
    if (output && output.state !== "finalized" && output.state !== "canceled") await output.cancel().catch(() => undefined);
    if (error instanceof AppleLivePhotoError) throw error;
    throw new Error("无法读取或转换这段 MOV 视频，请确认文件完整，或将视频转换为 H.264 MOV 后重试。");
  } finally {
    input.dispose();
  }
}
