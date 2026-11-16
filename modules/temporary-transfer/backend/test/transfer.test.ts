import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { TransferStore } from "../src/store.js";
import { SettingsStore } from "../src/settings.js";
import { registerRoutes } from "../src/routes.js";

test("text sharing keeps the code stable, isolates owners and enforces revocation", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "toolnest-transfer-test-"));
  const store = new TransferStore(dir);
  const settings = new SettingsStore(dir);
  await settings.load();
  const app = Fastify();
  registerRoutes(app, store, settings, new Set());
  t.after(async () => { await app.close(); store.close(); await rm(dir, { recursive: true, force: true }); });
  const headers = { "x-toolnest-user-id": "1", "x-toolnest-user-is-admin": "true" };
  const create = await app.inject({ method: "POST", url: "/transfers", headers, payload: { kind: "text", title: "文字投递", content: "跨设备测试", hours: 1 } });
  assert.equal(create.statusCode, 201);
  const { id, code } = create.json() as { id: string; code: string };
  const share = await app.inject({ method: "GET", url: `/transfers/${id}/share`, headers });
  assert.equal(share.json().code, code);
  const other = await app.inject({ method: "GET", url: `/transfers/${id}/share`, headers: { "x-toolnest-user-id": "2" } });
  assert.equal(other.statusCode, 404);
  const wrong = await app.inject({ method: "POST", url: `/public/${id}/verify`, payload: { code: code === "000000" ? "000001" : "000000" } });
  assert.equal(wrong.statusCode, 403);
  const valid = await app.inject({ method: "POST", url: `/public/${id}/verify`, payload: { code } });
  assert.equal(valid.json().content, "跨设备测试");
  assert.equal(valid.headers["cache-control"], "no-store");
  const revoke = await app.inject({ method: "DELETE", url: `/transfers/${id}`, headers });
  assert.equal(revoke.statusCode, 200);
  assert.equal((await app.inject({ method: "POST", url: `/public/${id}/verify`, payload: { code } })).statusCode, 403);
  store.purgeExpiredText();
  assert.equal(store.usage(), 0);
});

test("share keys survive restart and text is counted against capacity", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "toolnest-transfer-test-"));
  let store = new TransferStore(dir);
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }); });
  const item = store.createText("1", "测试", "你好", Date.now() + 60_000, null, 100);
  assert.equal(store.usage(), Buffer.byteLength("你好"));
  assert.throws(() => store.createText("1", "测试", "超过容量", Date.now() + 60_000, null, 6), /暂存空间不足/);
  store.close();
  store = new TransferStore(dir);
  assert.equal(store.shareCode("1", item.id), item.code);
  assert.equal(store.verify(item.id, item.code)?.content, "你好");
});

test("settings changes require a trusted administrator and never return secrets", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "toolnest-transfer-test-"));
  const store = new TransferStore(dir);
  const settings = new SettingsStore(dir);
  await settings.load();
  const app = Fastify();
  registerRoutes(app, store, settings, new Set());
  t.after(async () => { await app.close(); store.close(); await rm(dir, { recursive: true, force: true }); });
  const payload = { defaultHours: 24, maxHours: 168, maxFileBytes: 1024, maxTotalBytes: 2048, maxConcurrentUploads: 2,
    r2: { accountId: "0".repeat(32), bucket: "test-bucket", accessKeyId: "test-access", secretAccessKey: "test-secret" } };
  assert.equal((await app.inject({ method: "PUT", url: "/transfer-settings", headers: { "x-toolnest-user-id": "2" }, payload })).statusCode, 403);
  const saved = await app.inject({ method: "PUT", url: "/transfer-settings", headers: { "x-toolnest-user-id": "1", "x-toolnest-user-is-admin": "true" }, payload });
  assert.equal(saved.statusCode, 200);
  assert.doesNotMatch(saved.body, /test-access|test-secret/);
  const read = await app.inject({ method: "GET", url: "/transfer-settings", headers: { "x-toolnest-user-id": "1" } });
  assert.equal(read.json().r2.configured, true);
  assert.doesNotMatch(read.body, /test-access|test-secret/);
});

test("file reservations are idempotent and a spent grant is cleaned after the URL grace period", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "toolnest-transfer-test-"));
  const store = new TransferStore(dir);
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }); });
  const transfer = store.createFiles("1", "测试文件", Date.now() + 3_600_000, 1);
  const id = "66abbc5a-8e7b-4ac8-b5ea-46cdbb98ef5a";
  assert.equal(store.addFile("1", transfer.id, id, "example.txt", 8, 16).existing, false);
  assert.equal(store.addFile("1", transfer.id, id, "example.txt", 8, 16).existing, true);
  assert.throws(() => store.addFile("1", transfer.id, id, "different.txt", 8, 16), /上传文件信息不一致/);
  assert.equal(store.usage(), 8);
  assert.equal(store.setUploadId(id, "upload"), true);
  assert.equal(store.markFileReady(id), true);
  assert.equal(store.publish("1", transfer.id), true);
  assert.ok(store.claimFileGrant(transfer.id, id, transfer.code));
  assert.equal(store.claimFileGrant(transfer.id, id, transfer.code), null);
  assert.equal(store.verify(transfer.id, transfer.code), null);
  assert.equal(store.cleanupCandidates().length, 0);
  const originalNow = Date.now;
  try {
    const afterGrace = originalNow() + 121_000;
    Date.now = () => afterGrace;
    assert.equal(store.cleanupCandidates().length, 1);
  } finally { Date.now = originalNow; }
});
