import { deviceProfile } from "./device-profile";
import type { CropRect } from "../types";

export interface EmbeddedMotionPhoto {
  video: Blob;
  presentationTimestampUs: number | null;
}

const xmpIdentifier = "http://ns.adobe.com/xap/1.0/\0";
const cameraNamespace = "http://ns.google.com/photos/1.0/camera/";
const containerNamespace = "http://ns.google.com/photos/1.0/container/";
const itemNamespace = "http://ns.google.com/photos/1.0/container/item/";
const maximumMotionDurationSeconds = 15;
const maximumGifFrames = 120;
const maximumGifDecodedPixels = 80_000_000;
const maximumVideoSide = 1440;
const maximumUploadBytes = 30 * 1024 * 1024;
// H.264 coded dimensions are even; the confirmed 976 × 596 display size already meets this requirement.
const videoOutputWidth = (deviceProfile.output.width + 1) & ~1;
const videoOutputHeight = (deviceProfile.output.height + 1) & ~1;

type AnimatedImageFrame = CanvasImageSource & {
  duration: number | null;
  displayWidth: number;
  displayHeight: number;
  close(): void;
};

interface AnimatedImageTrack {
  animated: boolean;
  frameCount: number;
}

interface AnimatedImageDecoder {
  tracks: {
    ready: Promise<void>;
    selectedTrack: AnimatedImageTrack | null;
  };
  decode(options: { frameIndex: number; completeFramesOnly: boolean }): Promise<{ image: AnimatedImageFrame }>;
  close(): void;
}

interface AnimatedImageDecoderConstructor {
  new(options: { data: ArrayBuffer; type: string; preferAnimation: boolean }): AnimatedImageDecoder;
  isTypeSupported(type: string): Promise<boolean>;
}

export interface GifMotionPhotoConversion {
  sourceFile: File;
  video: Blob;
  width: number;
  height: number;
  frameCount: number;
}

function createMotionPhotoXmp(videoLength: number): Uint8Array {
  const xmp = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="ToolNest">` +
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
    `<rdf:Description rdf:about="" xmlns:GCamera="${cameraNamespace}" xmlns:Container="${containerNamespace}" xmlns:Item="${itemNamespace}" GCamera:MotionPhoto="1" GCamera:MotionPhotoVersion="1" GCamera:MotionPhotoPresentationTimestampUs="0">` +
    `<Container:Directory><rdf:Seq>` +
    `<rdf:li rdf:parseType="Resource"><Container:Item Item:Mime="image/jpeg" Item:Semantic="Primary" Item:Length="0"/></rdf:li>` +
    `<rdf:li rdf:parseType="Resource"><Container:Item Item:Mime="video/mp4" Item:Semantic="MotionPhoto" Item:Length="${videoLength}"/></rdf:li>` +
    `</rdf:Seq></Container:Directory></rdf:Description></rdf:RDF></x:xmpmeta>` +
    `<?xpacket end="w"?>`;
  const packet = new TextEncoder().encode(`${xmpIdentifier}${xmp}`);
  const length = packet.byteLength + 2;
  if (length > 0xffff) throw new Error("动态照片元数据过长，无法封装 Live Photo。");
  const segment = new Uint8Array(length + 2);
  segment[0] = 0xff;
  segment[1] = 0xe1;
  segment[2] = length >> 8;
  segment[3] = length & 0xff;
  segment.set(packet, 4);
  return segment;
}

function packageMotionPhoto(jpeg: Blob, video: Blob, name: string): File {
  const xmpSegment = createMotionPhotoXmp(video.size);
  const stem = name.replace(/\.[^.]+$/, "") || "背屏动态壁纸";
  return new File([
    jpeg.slice(0, 2),
    xmpSegment,
    jpeg.slice(2),
    video,
  ], `${stem}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("无法生成 GIF 的首帧图片。")), type, quality);
  });
}

function evenDimension(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

/** Decode an animated GIF in-browser and package its frames as an Android Motion Photo JPG. */
export async function convertGifToMotionPhoto(
  file: File,
  onProgress: (progress: number) => void,
): Promise<GifMotionPhotoConversion> {
  const Decoder = (globalThis as typeof globalThis & { ImageDecoder?: AnimatedImageDecoderConstructor }).ImageDecoder;
  if (!Decoder || !await Decoder.isTypeSupported("image/gif")) {
    throw new Error("当前浏览器不支持 GIF 动画解码，请使用最新版 Chrome 或 Edge。原生 Live Photo JPG 仍可直接导入。");
  }

  const decoder = new Decoder({ data: await file.arrayBuffer(), type: "image/gif", preferAnimation: true });
  let output: import("mediabunny").Output | undefined;
  let videoSource: import("mediabunny").CanvasSource | undefined;
  let firstFrame: AnimatedImageFrame | undefined;
  try {
    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack;
    const frameCount = track?.frameCount ?? 0;
    if (!track?.animated || frameCount < 2) throw new Error("这个 GIF 没有多帧动画内容。");
    if (frameCount > maximumGifFrames) {
      throw new Error(`GIF 最多支持 ${maximumGifFrames} 帧；请先缩短动画或降低帧数。`);
    }

    firstFrame = (await decoder.decode({ frameIndex: 0, completeFramesOnly: true })).image;
    const sourceWidth = firstFrame.displayWidth;
    const sourceHeight = firstFrame.displayHeight;
    if (!sourceWidth || !sourceHeight || sourceWidth * sourceHeight * frameCount > maximumGifDecodedPixels) {
      throw new Error("GIF 总像素量过大，请缩小图片或减少动画帧数后重试。");
    }
    const scale = Math.min(1, maximumVideoSide / Math.max(sourceWidth, sourceHeight));
    const width = evenDimension(sourceWidth * scale);
    const height = evenDimension(sourceHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("浏览器无法创建 GIF 转换画布。");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(firstFrame, 0, 0, width, height);
    const still = await canvasBlob(canvas, "image/jpeg", 0.92);

    const { BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality, canEncodeVideo } = await import("mediabunny");
    const quality = new Quality("high");
    if (!await canEncodeVideo("avc", { width, height, quality, frameRate: 30 })) {
      throw new Error("当前浏览器没有可用的 H.264 编码器，无法生成安卓 Live Photo。请使用最新版 Chrome 或 Edge，并更新显卡驱动。");
    }

    const target = new BufferTarget();
    output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
    videoSource = new CanvasSource(canvas, { codec: "avc", bitrate: 1_800_000, keyFrameInterval: 1 });
    output.addVideoTrack(videoSource);
    await output.start();

    let timestamp = 0;
    for (let index = 0; index < frameCount; index += 1) {
      let frame = firstFrame;
      if (index > 0) frame = (await decoder.decode({ frameIndex: index, completeFramesOnly: true })).image;
      const durationUs = frame.duration && frame.duration > 0 ? frame.duration : 100_000;
      const duration = durationUs / 1_000_000;
      if (timestamp + duration > maximumMotionDurationSeconds) {
        if (frame !== firstFrame) frame.close();
        throw new Error(`GIF 转换后的动态片段不能超过 ${maximumMotionDurationSeconds} 秒。`);
      }
      context.fillStyle = "#fff";
      context.fillRect(0, 0, width, height);
      context.drawImage(frame, 0, 0, width, height);
      await videoSource.add(timestamp, duration);
      timestamp += duration;
      if (frame !== firstFrame) frame.close();
      onProgress((index + 1) / frameCount);
    }
    firstFrame.close();
    firstFrame = undefined;
    videoSource.close();
    videoSource = undefined;
    await output.finalize();
    const mp4 = target.buffer;
    if (!mp4?.byteLength) throw new Error("GIF 动画编码没有生成有效视频。");
    const video = new Blob([mp4], { type: "video/mp4" });
    if (video.size > maximumUploadBytes) throw new Error("GIF 转换后的视频超过 30 MB，请缩短动画时长或减少帧数。");
    const sourceFile = packageMotionPhoto(still, video, file.name);
    if (sourceFile.size > maximumUploadBytes) throw new Error("GIF 首帧图片超过 30 MB，请缩小原图后重试。");
    return { sourceFile, video, width, height, frameCount };
  } catch (error) {
    if (output && output.state !== "finalized" && output.state !== "canceled") await output.cancel().catch(() => undefined);
    throw error;
  } finally {
    firstFrame?.close();
    videoSource?.close();
    decoder.close();
  }
}

function readXmpPacket(bytes: Uint8Array): string | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const decoder = new TextDecoder("ascii");
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) return null;
    if (marker === 0x01 || (marker !== undefined && marker >= 0xd0 && marker <= 0xd7)) continue;
    const segmentLength = ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    const payloadStart = offset + 2;
    const payloadEnd = offset + segmentLength;
    if (marker === 0xe1) {
      const payload = decoder.decode(bytes.subarray(payloadStart, payloadEnd));
      if (payload.startsWith(xmpIdentifier)) return payload.slice(xmpIdentifier.length);
    }
    offset += segmentLength;
  }
  return null;
}

function readMotionMetadata(xmp: string): { videoLength: number; presentationTimestampUs: number | null } | null {
  if (!/(?:[A-Za-z_][\w.-]*:)?MotionPhoto\s*=\s*["']1["']/.test(xmp)) return null;
  const itemPattern = /<(?:[A-Za-z_][\w.-]*:)?li\b[^>]*>[\s\S]*?<\/(?:[A-Za-z_][\w.-]*:)?li\s*>/gi;
  const motionItem = [...xmp.matchAll(itemPattern)].map((match) => match[0]).find((item) =>
    /(?:[A-Za-z_][\w.-]*:)?Mime\s*=\s*["']video\/mp4["']/.test(item) &&
    /(?:[A-Za-z_][\w.-]*:)?Semantic\s*=\s*["']MotionPhoto["']/.test(item),
  );
  const length = Number(motionItem?.match(/(?:[A-Za-z_][\w.-]*:)?Length\s*=\s*["'](\d+)["']/)?.[1]);
  if (!Number.isSafeInteger(length) || length <= 0) {
    throw new Error("这张图片标记为 Live Photo，但没有可读取的视频轨道。");
  }
  const timestampValue = xmp.match(/(?:[A-Za-z_][\w.-]*:)?MotionPhotoPresentationTimestampUs\s*=\s*["'](-?\d+)["']/)?.[1];
  const presentationTimestampUs = timestampValue === undefined ? null : Number(timestampValue);
  if (presentationTimestampUs !== null && (!Number.isSafeInteger(presentationTimestampUs) || presentationTimestampUs < -1)) {
    throw new Error("动态照片关键帧时间无效，无法生成 Live Photo。");
  }
  return { videoLength: length, presentationTimestampUs };
}

function isMp4(bytes: Uint8Array): boolean {
  return bytes.length >= 16 &&
    String.fromCharCode(...bytes.subarray(4, 8)) === "ftyp" &&
    String.fromCharCode(...bytes.subarray(8, 12)).trim().length > 0;
}

export async function extractEmbeddedMotionPhoto(file: File): Promise<EmbeddedMotionPhoto | null> {
  const header = new Uint8Array(await file.slice(0, Math.min(file.size, 512_000)).arrayBuffer());
  const xmp = readXmpPacket(header);
  if (!xmp) return null;
  const metadata = readMotionMetadata(xmp);
  if (!metadata) return null;
  if (metadata.videoLength > file.size) throw new Error("动态视频数据不完整，请重新选择原始 Live Photo。");
  const video = file.slice(file.size - metadata.videoLength, file.size, "video/mp4");
  if (!isMp4(new Uint8Array(await video.slice(0, 32).arrayBuffer()))) {
    throw new Error("未能在图片末尾定位到有效 MP4 视频，请选择完整的 Live Photo 文件。");
  }
  return { video, presentationTimestampUs: metadata.presentationTimestampUs };
}

export async function createCroppedMotionVideo(
  video: Blob,
  crop: CropRect,
  onProgress: (progress: number) => void,
): Promise<Blob> {
  const {
    ALL_FORMATS,
    BlobSource,
    BufferTarget,
    canEncodeVideo,
    Conversion,
    Input,
    Mp4OutputFormat,
    Output,
    Quality,
  } = await import("mediabunny");
  const input = new Input({ source: new BlobSource(video), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error("Live Photo 中没有可播放的视频轨道。");
    const [width, height, duration] = await Promise.all([
      track.getDisplayWidth(),
      track.getDisplayHeight(),
      track.computeDuration(),
    ]);
    if (duration <= 0 || duration > maximumMotionDurationSeconds) {
      throw new Error(`动态视频时长需要在 0 到 ${maximumMotionDurationSeconds} 秒之间。`);
    }
    const quality = new Quality("high");
    if (!await canEncodeVideo("avc", {
      width: videoOutputWidth,
      height: videoOutputHeight,
      quality,
      frameRate: 30,
    })) {
      throw new Error("当前浏览器不支持 H.264 动态照片编码，请使用最新版 Chrome 或 Edge 重试。");
    }

    const target = new BufferTarget();
    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: "in-memory" }),
      target,
    });
    const conversion = await Conversion.init({
      input,
      output,
      tracks: "primary",
      copy: false,
      video: async (videoTrack) => {
        const [displayWidth, displayHeight] = await Promise.all([
          videoTrack.getDisplayWidth(),
          videoTrack.getDisplayHeight(),
        ]);
        const left = Math.min(displayWidth - 1, Math.max(0, Math.round(crop.left * displayWidth)));
        const top = Math.min(displayHeight - 1, Math.max(0, Math.round(crop.top * displayHeight)));
        return {
          codec: "avc",
          quality,
          width: videoOutputWidth,
          height: videoOutputHeight,
          fit: "fill",
          frameRate: 30,
          crop: {
            left,
            top,
            width: Math.min(displayWidth - left, Math.max(1, Math.round(crop.width * displayWidth))),
            height: Math.min(displayHeight - top, Math.max(1, Math.round(crop.height * displayHeight))),
          },
          forceTranscode: true,
          allowTransformationMetadata: false,
        };
      },
      audio: { discard: true },
      showWarnings: false,
    });
    if (!conversion.isValid) throw new Error("当前 Live Photo 视频编码参数不受支持。");
    conversion.onProgress = (progress) => onProgress(Math.max(0, Math.min(1, progress)));
    await conversion.execute();
    if (!target.buffer?.byteLength) throw new Error("动态视频编码没有生成有效文件。");
    return new Blob([target.buffer], { type: "video/mp4" });
  } finally {
    input.dispose();
  }
}
