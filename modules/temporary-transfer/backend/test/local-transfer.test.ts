import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { request as httpRequest } from "node:http";
import Fastify from "fastify";
import { TransferStore } from "../src/store.js";
import { SettingsStore } from "../src/settings.js";
import { LocalStorage } from "../src/local-storage.js";
import { registerRoutes } from "../src/routes.js";
import { cleanupTransfers } from "../src/cleanup.js";

const headers = { "x-toolnest-user-id": "1", "x-toolnest-user-is-admin": "true" };
const modulePath = (url: string) => url.replace("/api/v1/modules/temporary-transfer", "");
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

async function setup(t: TestContext) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "toolnest-local-"));
  const settings = new SettingsStore(dir); await settings.load();
  const env = { dir, settings, store: new TransferStore(dir), local: new LocalStorage(dir), app: Fastify() };
  const register = () => registerRoutes(env.app, env.store, settings, new Set(), undefined, env.local);
  register();
  t.after(async () => {
    await env.app.close(); env.store.close();
    assert.ok(dir.startsWith(path.resolve(os.tmpdir()) + path.sep + "toolnest-local-"));
    await rm(dir, { recursive: true, force: true });
  });
  return Object.assign(env, {
    async restart() {
      await env.app.close(); env.store.close();
      env.store = new TransferStore(dir); env.local = new LocalStorage(dir); env.app = Fastify(); register();
    },
    async prepare(size: number, maxGrants: number | null = null) {
      const created = await env.app.inject({ method: "POST", url: "/transfers", headers, payload: { kind: "files", title: "本地传输", hours: 1, maxGrants } });
      assert.equal(created.statusCode, 201, created.body);
      const transfer = created.json() as { id: string; code: string };
      const file = await env.app.inject({ method: "POST", url: `/transfers/${transfer.id}/files`, headers, payload: { filename: "中文文件.bin", size, clientId: randomUUID() } });
      assert.equal(file.statusCode, 201, file.body);
      return { ...transfer, fileId: file.json().id as string };
    },
    async sign(id: string, fileId: string, part: number) {
      const response = await env.app.inject({ method: "POST", url: `/transfers/${id}/files/${fileId}/parts/${part}`, headers, payload: {} });
      assert.equal(response.statusCode, 200, response.body);
      return modulePath(response.json().url as string);
    },
    async publish(id: string, fileId: string) {
      const complete = await env.app.inject({ method: "POST", url: `/transfers/${id}/files/${fileId}/complete`, headers, payload: {} });
      assert.equal(complete.statusCode, 200, complete.body);
      const published = await env.app.inject({ method: "POST", url: `/transfers/${id}/publish`, headers, payload: {} });
      assert.equal(published.statusCode, 200, published.body);
    },
    async grant(id: string, code: string, fileId: string) {
      const response = await env.app.inject({ method: "POST", url: `/public/${id}/files/${fileId}/download`, payload: { code } });
      assert.equal(response.statusCode, 200, response.body);
      return modulePath(response.json().url as string);
    },
  });
}

test("without R2, multipart uploads survive restart, preserve hashes and support range downloads", async (t) => {
  const env = await setup(t);
  assert.equal(env.settings.publicValue().storageBackend, "local");
  const bytes = Buffer.alloc(5 * 1024 * 1024 + 19, 71);
  const file = await env.prepare(bytes.length);
  const first = await env.sign(file.id, file.fileId, 1);
  assert.equal((await env.app.inject({ method: "PUT", url: first, headers: { "content-type": "application/octet-stream" }, payload: bytes.subarray(0, 5 * 1024 * 1024) })).statusCode, 204);
  await env.restart();
  const parts = await env.app.inject({ method: "GET", url: `/transfers/${file.id}/files/${file.fileId}/parts`, headers });
  assert.equal(parts.json().parts.length, 1);
  const second = await env.sign(file.id, file.fileId, 2);
  assert.equal((await env.app.inject({ method: "PUT", url: second, headers: { "content-type": "application/octet-stream" }, payload: bytes.subarray(5 * 1024 * 1024) })).statusCode, 204);
  await env.publish(file.id, file.fileId);
  const url = await env.grant(file.id, file.code, file.fileId);
  const downloaded = await env.app.inject({ method: "GET", url });
  assert.equal(digest(downloaded.rawPayload), digest(bytes));
  assert.match(String(downloaded.headers["content-disposition"]), /filename\*=UTF-8/);
  const partial = await env.app.inject({ method: "GET", url, headers: { range: "bytes=7-17" } });
  assert.equal(partial.statusCode, 206); assert.deepEqual(partial.rawPayload, bytes.subarray(7, 18));
  assert.equal((await env.app.inject({ method: "GET", url, headers: { range: "bytes=999999999-" } })).statusCode, 416);
});

test("local upload URLs reject tampering, wrong sizes, wrong operations and revoked transfers", async (t) => {
  const env = await setup(t); const file = await env.prepare(3);
  const url = await env.sign(file.id, file.fileId, 1);
  const token = url.split("token=")[1]!; const [payload, signature] = token.split(".");
  const forged = `${payload}.${signature![0] === "a" ? "b" : "a"}${signature!.slice(1)}`;
  assert.equal((await env.app.inject({ method: "PUT", url: url.replace(token, forged), headers: { "content-type": "application/octet-stream" }, payload: Buffer.alloc(3) })).statusCode, 403);
  assert.equal((await env.app.inject({ method: "PUT", url, headers: { "content-type": "application/octet-stream" }, payload: Buffer.alloc(4) })).statusCode, 400);
  assert.equal((await env.app.inject({ method: "GET", url: "/public/local-download" })).statusCode, 403);
  const downloadToken = new URL(await env.local.download("unrelated"), "http://local").searchParams.get("token")!;
  assert.equal((await env.app.inject({ method: "PUT", url: `/public/local-upload?token=${downloadToken}`, headers: { "content-type": "application/octet-stream" }, payload: Buffer.alloc(3) })).statusCode, 403);
  env.store.revoke("1", file.id);
  assert.equal((await env.app.inject({ method: "PUT", url, headers: { "content-type": "application/octet-stream" }, payload: Buffer.alloc(3) })).statusCode, 403);
});

test("local downloads enforce codes, grant limits, token expiry and immediate revocation", async (t) => {
  const env = await setup(t); const file = await env.prepare(0, 1); await env.publish(file.id, file.fileId);
  const wrong = await env.app.inject({ method: "POST", url: `/public/${file.id}/files/${file.fileId}/download`, payload: { code: "wrong" } });
  assert.equal(wrong.statusCode, 403);
  const url = await env.grant(file.id, file.code, file.fileId);
  assert.equal((await env.app.inject({ method: "GET", url })).statusCode, 200);
  assert.equal((await env.app.inject({ method: "POST", url: `/public/${file.id}/files/${file.fileId}/download`, payload: { code: file.code } })).statusCode, 403);
  const originalNow = Date.now;
  try { Date.now = () => originalNow() + 121_000; assert.equal((await env.app.inject({ method: "GET", url })).statusCode, 403); }
  finally { Date.now = originalNow; }
  env.store.revoke("1", file.id);
  assert.equal((await env.app.inject({ method: "GET", url })).statusCode, 404);
});

test("local reservations respect quotas and revoke cleanup removes partial and completed files without R2", async (t) => {
  const env = await setup(t); const file = await env.prepare(3);
  const url = await env.sign(file.id, file.fileId, 1);
  await env.app.inject({ method: "PUT", url, headers: { "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
  const empty = await env.prepare(0); await env.publish(empty.id, empty.fileId);
  const object = env.store.ownedFile("1", empty.id, empty.fileId)!;
  assert.equal(await env.local.hasCompletedObject(object.object_key, 0), true);
  assert.throws(() => env.store.addFile("1", file.id, randomUUID(), "over.bin", 4, 5, "local"), /暂存空间不足/);
  env.store.revoke("1", file.id); env.store.revoke("1", empty.id);
  await cleanupTransfers(env.store, env.settings, new Set(), env.local);
  assert.equal(env.store.usage(), 0); assert.equal(env.store.cleanupFailures(), 0);
  assert.equal(await env.local.hasCompletedObject(object.object_key, 0), false);
});

test("cleanup skips unnecessary SQLite writes and retries actual expired content after a lock clears", async (t) => {
  const env = await setup(t);
  const db = new DatabaseSync(path.join(env.dir, "transfers.sqlite"));
  const runCleanup = () => cleanupTransfers(env.store, env.settings, new Set(), env.local);
  try {
    db.exec("BEGIN IMMEDIATE");
    await runCleanup();
    db.exec("ROLLBACK");

    env.store.createText("1", "Expired", "content", Date.now() - 1000, null, 1024);
    db.exec("BEGIN IMMEDIATE");
    await assert.rejects(runCleanup, /清除失效投递内容（SQLITE_BUSY\/5）/);
    assert.equal(env.store.usage(), 7);
    db.exec("ROLLBACK");

    await runCleanup();
    assert.equal(env.store.usage(), 0);
  } finally { db.close(); }
});

test("configuring R2 does not relocate existing local files or make their downloads use R2", async (t) => {
  const env = await setup(t); const file = await env.prepare(0); await env.publish(file.id, file.fileId);
  const r2 = { accountId: "a".repeat(32), bucket: "test-bucket", accessKeyId: "test-access", secretAccessKey: "test-secret" };
  const settings = await env.app.inject({ method: "PUT", url: "/transfer-settings", headers, payload: { r2 } });
  assert.equal(settings.statusCode, 200); assert.equal(settings.json().storageBackend, "r2");
  const url = await env.grant(file.id, file.code, file.fileId);
  assert.match(url, /^\/public\/local-download\?/);
  assert.equal((await env.app.inject({ method: "GET", url })).statusCode, 200);
  assert.equal(env.store.ownedFile("1", file.id, file.fileId)?.storage_backend, "local");
});

test("legacy metadata remains R2 after adding the storage location column", async (t) => {
  const env = await setup(t);
  const transfer = env.store.createFiles("1", "旧版投递", Date.now() + 3600000, null);
  const id = randomUUID(); env.store.addFile("1", transfer.id, id, "legacy.bin", 1, 100);
  await env.app.close(); env.store.close();
  const db = new DatabaseSync(path.join(env.dir, "transfers.sqlite"));
  db.exec("ALTER TABLE files DROP COLUMN storage_backend"); db.close();
  env.store = new TransferStore(env.dir); env.app = Fastify();
  assert.equal(env.store.ownedFile("1", transfer.id, id)?.storage_backend, "r2");
});

test("settings distinguish a missing host administrator context from a non-administrator", async (t) => {
  const env = await setup(t);
  const missing = { "x-toolnest-user-id": "1" };
  const context = await env.app.inject({ method: "GET", url: "/transfer-settings", headers: missing });
  assert.equal(context.json().adminContextAvailable, false);
  assert.equal(context.json().canManageSettings, false);
  const denied = await env.app.inject({ method: "PUT", url: "/transfer-settings", headers: missing, payload: { defaultHours: 12 } });
  assert.equal(denied.statusCode, 403); assert.match(denied.json().message, /宿主后端/);
  const nonAdmin = await env.app.inject({ method: "PUT", url: "/transfer-settings", headers: { ...missing, "x-toolnest-user-is-admin": "false" }, payload: { defaultHours: 12 } });
  assert.equal(nonAdmin.statusCode, 403); assert.match(nonAdmin.json().message, /仅管理员/);
  const saved = await env.app.inject({ method: "PUT", url: "/transfer-settings", headers, payload: { defaultHours: 12, r2: null } });
  assert.equal(saved.statusCode, 200); assert.equal(saved.json().canManageSettings, true); assert.equal(saved.json().storageBackend, "local");
});

test("aborted browser uploads release their concurrency slots", async (t) => {
  const env = await setup(t); const file = await env.prepare(3);
  const signed = await env.sign(file.id, file.fileId, 1);
  const origin = await env.app.listen({ host: "127.0.0.1", port: 0 });
  for (let index = 0; index < 10; index += 1) {
    await new Promise<void>((resolve) => {
      const request = httpRequest(new URL(signed, origin), { method: "PUT", headers: { "content-type": "application/octet-stream", "content-length": "3" } });
      request.on("error", () => resolve());
      request.write(Buffer.from("a"));
      setTimeout(() => request.destroy(new Error("Synthetic browser pause")), 20);
    });
  }
  await new Promise((resolve) => setTimeout(resolve, 30));
  const response = await env.app.inject({ method: "PUT", url: signed, headers: { "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
  assert.equal(response.statusCode, 204, response.body);
});
