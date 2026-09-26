import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import sharp from "sharp";

const root = await mkdtemp(path.join(os.tmpdir(), "toolnest-rear-wallpaper-test-"));
process.env.NODE_ENV = "test";
process.env.TOOLNEST_PLUGIN_ID = "xiaomi-rear-wallpaper";
process.env.TOOLNEST_PLUGIN_RELEASE_ID = "test-release";
process.env.TOOLNEST_PLUGIN_TOKEN = "test-internal-token";
process.env.TOOLNEST_PLUGIN_DATA_DIR = path.join(root, "default-data");
process.env.TOOLNEST_PLUGIN_LOG_DIR = path.join(root, "logs");

const { createApp } = await import("../dist/main.js");
const { packageMotionPhoto, readEmbeddedMotionVideo } = await import("../dist/live-photo.js");
const token = "test-internal-token";

async function removeTree(target) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt >= 10 || !error || typeof error !== "object" || !["EBUSY", "EPERM"].includes(error.code)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
  }
}
const cropFor = (width, height) => {
  const targetRatio = 976 / 596;
  const ratio = width / height;
  if (ratio > targetRatio) {
    const cropWidth = (targetRatio * height) / width;
    return { left: (1 - cropWidth) / 2, top: 0, width: cropWidth, height: 1 };
  }
  const cropHeight = width / targetRatio / height;
  return { left: 0, top: (1 - cropHeight) / 2, width: 1, height: cropHeight };
};

function headers(ownerId) {
  return {
    "x-toolnest-internal-token": token,
    "x-toolnest-user-id": ownerId,
  };
}

function multipartPayload({ buffer, mime, filename, crop, motionVideo, presentationTimestampUs }) {
  const boundary = `----wallpaper-${randomUUID()}`;
  const chunks = [
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="crop"\r\n\r\n${JSON.stringify(crop)}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n`),
  ];
  if (motionVideo) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="motionVideo"; filename="motion.mp4"\r\nContent-Type: video/mp4\r\n\r\n`));
    chunks.push(motionVideo, Buffer.from(`\r\n`));
  }
  if (presentationTimestampUs !== undefined && presentationTimestampUs !== null) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="presentationTimestampUs"\r\n\r\n${presentationTimestampUs}\r\n`));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function upload(app, ownerId, file) {
  const { payload, contentType } = multipartPayload(file);
  const response = await app.inject({
    method: "POST",
    url: "/wallpapers",
    headers: { ...headers(ownerId), "content-type": contentType },
    payload,
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json();
}

async function waitForJob(app, ownerId, jobId) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const response = await app.inject({
      method: "GET",
      url: `/jobs/${jobId}`,
      headers: headers(ownerId),
    });
    assert.equal(response.statusCode, 200, response.body);
    const job = response.json();
    if (job.state === "completed" || job.state === "failed") return job;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`图片任务 ${jobId} 超时`);
}

async function makeApp(t, dataDir = path.join(root, randomUUID())) {
  const app = await createApp({ dataDir, token });
  await app.ready();
  t.after(async () => {
    await app.close();
    await removeTree(dataDir);
  });
  return app;
}

test("静态图片可裁切、编辑、跨重启持久化且按用户隔离", async (t) => {
  const dataDir = path.join(root, "static-data");
  const app = await makeApp(t, dataDir);
  const image = await sharp({
    create: { width: 160, height: 100, channels: 3, background: { r: 35, g: 110, b: 190 } },
  }).png().toBuffer();

  const missingIdentity = await app.inject({ method: "GET", url: "/wallpapers", headers: { "x-toolnest-internal-token": token } });
  assert.equal(missingIdentity.statusCode, 401);
  const missingToken = await app.inject({ method: "GET", url: "/wallpapers", headers: { "x-toolnest-user-id": "1001" } });
  assert.equal(missingToken.statusCode, 401);

  const { wallpaper, job } = await upload(app, "1001", {
    buffer: image,
    mime: "image/png",
    filename: "blue.png",
    crop: cropFor(160, 100),
  });
  assert.equal((await waitForJob(app, "1001", job.id)).state, "completed");

  let exported = await app.inject({ method: "GET", url: `/wallpapers/${wallpaper.id}/export`, headers: headers("1001") });
  assert.equal(exported.statusCode, 200);
  assert.equal(exported.headers["content-type"], "image/png");
  let metadata = await sharp(exported.rawPayload).metadata();
  assert.equal(metadata.width, 976);
  assert.equal(metadata.height, 596);

  const otherUserRead = await app.inject({ method: "GET", url: `/wallpapers/${wallpaper.id}`, headers: headers("2002") });
  assert.equal(otherUserRead.statusCode, 404);
  const otherUserDelete = await app.inject({ method: "DELETE", url: `/wallpapers/${wallpaper.id}`, headers: headers("2002") });
  assert.equal(otherUserDelete.statusCode, 404);
  const otherUserList = await app.inject({ method: "GET", url: "/wallpapers", headers: headers("2002") });
  assert.deepEqual(otherUserList.json(), []);

  const updatedCrop = { ...wallpaper.crop, left: 0 };
  const update = await app.inject({
    method: "PUT",
    url: `/wallpapers/${wallpaper.id}/crop`,
    headers: { ...headers("1001"), "content-type": "application/json" },
    payload: JSON.stringify(updatedCrop),
  });
  assert.equal(update.statusCode, 200, update.body);
  assert.equal((await waitForJob(app, "1001", update.json().job.id)).state, "completed");

  await app.close();
  const restarted = await makeApp(t, dataDir);
  const persisted = await restarted.inject({ method: "GET", url: `/wallpapers/${wallpaper.id}`, headers: headers("1001") });
  assert.equal(persisted.statusCode, 200);
  assert.equal(persisted.json().state, "ready");
  assert.equal(persisted.json().crop.left, 0);

  exported = await restarted.inject({ method: "GET", url: `/wallpapers/${wallpaper.id}/export`, headers: headers("1001") });
  metadata = await sharp(exported.rawPayload).metadata();
  assert.equal(metadata.width, 976);
  assert.equal(metadata.height, 596);

  const removed = await restarted.inject({ method: "DELETE", url: `/wallpapers/${wallpaper.id}`, headers: headers("1001") });
  assert.equal(removed.statusCode, 204);
  assert.equal((await restarted.inject({ method: "GET", url: "/wallpapers", headers: headers("1001") })).json().length, 0);
});

test("拒绝 GIF 导入，避免生成背屏不支持的动图格式", async (t) => {
  const app = await makeApp(t);
  const rejected = await app.inject({
    method: "POST",
    url: "/wallpapers",
    headers: { ...headers("gif-owner"), "content-type": "multipart/form-data; boundary=unsupported-gif" },
    payload: Buffer.from(
      `--unsupported-gif\r\nContent-Disposition: form-data; name="crop"\r\n\r\n${JSON.stringify(cropFor(24, 16))}\r\n` +
      `--unsupported-gif\r\nContent-Disposition: form-data; name="file"; filename="animation.gif"\r\nContent-Type: image/gif\r\n\r\nGIF89a\r\n` +
      `--unsupported-gif--\r\n`,
    ),
  });
  assert.equal(rejected.statusCode, 415, rejected.body);
  assert.deepEqual((await app.inject({ method: "GET", url: "/wallpapers", headers: headers("gif-owner") })).json(), []);
});

test("安卓 Live Photo 可导出为含裁切 MP4 的 JPG 并支持再次裁切", async (t) => {
  const app = await makeApp(t);
  const still = await sharp({
    create: { width: 160, height: 100, channels: 3, background: { r: 190, g: 100, b: 55 } },
  }).jpeg().toBuffer();
  const motionVideo = Buffer.from([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0]);
  const sourceLivePhoto = packageMotionPhoto(still, motionVideo, 510_000);
  const { wallpaper, job } = await upload(app, "live-owner", {
    buffer: sourceLivePhoto,
    mime: "image/jpeg",
    filename: "MVIMG_test.jpg",
    crop: cropFor(160, 100),
    motionVideo,
    presentationTimestampUs: 510_000,
  });
  assert.equal(wallpaper.motionPhoto, true);
  assert.equal(wallpaper.outputFormat, "jpg");
  assert.equal((await waitForJob(app, "live-owner", job.id)).state, "completed");

  const exported = await app.inject({ method: "GET", url: `/wallpapers/${wallpaper.id}/export`, headers: headers("live-owner") });
  assert.equal(exported.statusCode, 200, exported.body);
  assert.equal(exported.headers["content-type"], "image/jpeg");
  const outputMetadata = await sharp(exported.rawPayload).metadata();
  assert.equal(outputMetadata.width, 976);
  assert.equal(outputMetadata.height, 596);
  const extracted = readEmbeddedMotionVideo(exported.rawPayload);
  assert.ok(extracted);
  assert.equal(extracted.presentationTimestampUs, 510_000);
  assert.deepEqual(extracted.video, motionVideo);

  const update = await app.inject({
    method: "PUT",
    url: `/wallpapers/${wallpaper.id}/crop`,
    headers: { ...headers("live-owner"), "content-type": "multipart/form-data; boundary=live-crop" },
    payload: Buffer.concat([
      Buffer.from(`--live-crop\r\nContent-Disposition: form-data; name="crop"\r\n\r\n${JSON.stringify({ ...wallpaper.crop, left: 0 })}\r\n`),
      Buffer.from(`--live-crop\r\nContent-Disposition: form-data; name="motionVideo"; filename="motion.mp4"\r\nContent-Type: video/mp4\r\n\r\n`),
      motionVideo,
      Buffer.from(`\r\n--live-crop\r\nContent-Disposition: form-data; name="presentationTimestampUs"\r\n\r\n510000\r\n--live-crop--\r\n`),
    ]),
  });
  assert.equal(update.statusCode, 200, update.body);
  assert.equal((await waitForJob(app, "live-owner", update.json().job.id)).state, "completed");
  const updatedExport = await app.inject({ method: "GET", url: `/wallpapers/${wallpaper.id}/export`, headers: headers("live-owner") });
  assert.ok(readEmbeddedMotionVideo(updatedExport.rawPayload));
});

test.after(async () => {
  await removeTree(root);
});
