import { WallpaperError } from "./errors.js";

const xmpIdentifier = Buffer.from("http://ns.adobe.com/xap/1.0/\0", "ascii");
const cameraNamespace = "http://ns.google.com/photos/1.0/camera/";
const containerNamespace = "http://ns.google.com/photos/1.0/container/";
const itemNamespace = "http://ns.google.com/photos/1.0/container/item/";

function createXmp(videoLength: number, presentationTimestampUs: number | null): Buffer {
  const timestamp = presentationTimestampUs === null ? "" : ` GCamera:MotionPhotoPresentationTimestampUs="${presentationTimestampUs}"`;
  const xmp = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>\n` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="ToolNest">` +
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
    `<rdf:Description rdf:about="" xmlns:GCamera="${cameraNamespace}" xmlns:Container="${containerNamespace}" xmlns:Item="${itemNamespace}" GCamera:MotionPhoto="1" GCamera:MotionPhotoVersion="1"${timestamp}>` +
    `<Container:Directory><rdf:Seq>` +
    `<rdf:li rdf:parseType="Resource"><Container:Item Item:Mime="image/jpeg" Item:Semantic="Primary" Item:Length="0"/></rdf:li>` +
    `<rdf:li rdf:parseType="Resource"><Container:Item Item:Mime="video/mp4" Item:Semantic="MotionPhoto" Item:Length="${videoLength}"/></rdf:li>` +
    `</rdf:Seq></Container:Directory></rdf:Description></rdf:RDF></x:xmpmeta>` +
    `<?xpacket end="w"?>`;
  const xml = Buffer.from(xmp, "utf8");
  const payload = Buffer.concat([xmpIdentifier, xml]);
  const segmentLength = payload.length + 2;
  if (segmentLength > 0xffff) throw new WallpaperError(422, "动态照片元数据过长，无法生成安卓动态照片。");
  return Buffer.concat([
    Buffer.from([0xff, 0xe1, (segmentLength >> 8) & 0xff, segmentLength & 0xff]),
    payload,
  ]);
}

export function assertMp4Video(video: Buffer): void {
  if (
    video.length < 16 ||
    video.toString("ascii", 4, 8) !== "ftyp" ||
    video.toString("ascii", 8, 12).trim().length === 0
  ) {
    throw new WallpaperError(422, "动态照片中的视频轨道无效，请重新上传 Live Photo。");
  }
}

export function packageMotionPhoto(
  jpeg: Buffer,
  video: Buffer,
  presentationTimestampUs: number | null,
): Buffer {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg[jpeg.length - 2] !== 0xff || jpeg[jpeg.length - 1] !== 0xd9) {
    throw new WallpaperError(500, "裁切后的照片格式无效，无法封装动态照片。");
  }
  assertMp4Video(video);
  const xmpSegment = createXmp(video.length, presentationTimestampUs);
  return Buffer.concat([jpeg.subarray(0, 2), xmpSegment, jpeg.subarray(2), video]);
}

export function parsePresentationTimestamp(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < -1) {
    throw new WallpaperError(422, "动态照片的关键帧时间无效，请重新选择图片。");
  }
  return parsed;
}

export function assertMotionPhotoUpload(imageFormat: string, video?: Buffer): void {
  if (!video) return;
  if (imageFormat !== "jpeg") throw new WallpaperError(422, "安卓动态照片必须使用 JPG/JPEG 主图片。");
  assertMp4Video(video);
}

export function readEmbeddedMotionVideo(buffer: Buffer): { video: Buffer; presentationTimestampUs: number | null } | null {
  const metadata = buffer.subarray(0, 512_000).toString("latin1");
  const xmpOffset = metadata.indexOf(xmpIdentifier.toString("latin1"));
  if (xmpOffset < 0) return null;
  const xmpStart = xmpOffset + xmpIdentifier.length;
  const xmpEnd = metadata.indexOf("</x:xmpmeta>", xmpStart);
  if (xmpEnd < 0 || xmpEnd - xmpStart > 256_000) return null;
  const xmp = metadata.slice(xmpStart, xmpEnd);
  if (!/(?:[A-Za-z_][\w.-]*:)?MotionPhoto\s*=\s*["']1["']/.test(xmp)) return null;
  const itemPattern = /<(?:[A-Za-z_][\w.-]*:)?li\b[^>]*>[\s\S]*?<\/(?:[A-Za-z_][\w.-]*:)?li\s*>/gi;
  const motionItem = [...xmp.matchAll(itemPattern)].map((match) => match[0]).find((item) =>
    /(?:[A-Za-z_][\w.-]*:)?Mime\s*=\s*["']video\/mp4["']/.test(item) &&
    /(?:[A-Za-z_][\w.-]*:)?Semantic\s*=\s*["']MotionPhoto["']/.test(item),
  );
  const lengthValue = motionItem?.match(/(?:[A-Za-z_][\w.-]*:)?Length\s*=\s*["'](\d+)["']/)?.[1];
  const length = Number(lengthValue);
  if (!Number.isSafeInteger(length) || length <= 0 || length > buffer.length) {
    throw new WallpaperError(422, "未能在动态照片中定位视频内容，请选择完整的安卓 Live Photo JPG。");
  }
  const video = buffer.subarray(buffer.length - length);
  assertMp4Video(video);
  const timestampValue = xmp.match(/(?:[A-Za-z_][\w.-]*:)?MotionPhotoPresentationTimestampUs\s*=\s*["'](-?\d+)["']/)?.[1];
  const presentationTimestampUs = timestampValue === undefined ? null : parsePresentationTimestamp(timestampValue);
  return { video, presentationTimestampUs };
}
