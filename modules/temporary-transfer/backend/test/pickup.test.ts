import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { TransferStore } from "../src/store.js";
import { SettingsStore } from "../src/settings.js";
import { registerRoutes } from "../src/routes.js";
const owner = { "x-toolnest-user-id": "1" };
test("pickup migration, restart, ownership, rotation, expiry and revocation", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "toolnest-pickup-"));
  let store = new TransferStore(dir);
  t.after(async () => {
    store.close();
    assert.ok(
      dir.startsWith(path.resolve(os.tmpdir()) + path.sep + "toolnest-pickup-"),
    );
    await rm(dir, { recursive: true, force: true });
  });
  const item = store.createText(
    "1",
    "文字",
    "<script>escaped</script>",
    Date.now() + 60000,
    null,
    10000,
  );
  assert.match(item.pickupCode, /^[A-Z0-9]{8}$/);
  assert.equal(
    store.resolvePickup(item.pickupCode)?.content,
    "<script>escaped</script>",
  );
  assert.equal(store.ownedContent("2", item.id), null);
  store.close();
  const db = new DatabaseSync(path.join(dir, "transfers.sqlite"));
  db.exec(
    "DROP INDEX transfers_pickup_hash; ALTER TABLE transfers DROP COLUMN pickup_hash; ALTER TABLE transfers DROP COLUMN pickup_counter",
  );
  db.close();
  store = new TransferStore(dir);
  assert.equal(store.sharePickupCode("1", item.id), item.pickupCode);
  assert.ok(store.verify(item.id, item.code));
  assert.ok(store.rotateCode("1", item.id));
  assert.equal(store.resolvePickup(item.pickupCode), null);
  const next = store.sharePickupCode("1", item.id)!;
  assert.notEqual(next, item.pickupCode);
  assert.ok(store.resolvePickup(next));
  store.revoke("1", item.id);
  assert.equal(store.resolvePickup(next), null);
  const expired = store.createText(
    "1",
    "过期",
    "文字",
    Date.now() - 1,
    null,
    10000,
  );
  assert.equal(store.resolvePickup(expired.pickupCode), null);
});
test("pickup API authentication, pin secrecy, ID binding and rate limit", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "toolnest-pickup-"));
  const store = new TransferStore(dir);
  const settings = new SettingsStore(dir);
  await settings.load();
  const app = Fastify();
  registerRoutes(app, store, settings, new Set());
  t.after(async () => {
    await app.close();
    store.close();
    assert.ok(
      dir.startsWith(path.resolve(os.tmpdir()) + path.sep + "toolnest-pickup-"),
    );
    await rm(dir, { recursive: true, force: true });
  });
  const item = store.createText(
    "1",
    "标题",
    "内容",
    Date.now() + 60000,
    null,
    10000,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/pickup",
        payload: { code: item.pickupCode },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        url: `/transfers/${item.id}/content`,
        headers: { "x-toolnest-user-id": "2" },
      })
    ).statusCode,
    404,
  );
  const html=await app.inject({url:`/public/${item.id}`});
  const policy=String(html.headers["content-security-policy"]);
  assert.match(policy,/style-src 'self' 'nonce-[A-Za-z0-9_-]+'/);
  assert.ok(!policy.includes("unsafe-inline")&&!policy.includes("connect-src 'self' https:"));
  const nonce=html.body.match(/name="toolnest-csp-nonce" content="([^"]+)"/)?.[1];
  assert.ok(nonce&&policy.includes(`'nonce-${nonce}'`));
  const success = await app.inject({
    method: "POST",
    url: "/pickup",
    headers: owner,
    payload: {
      code:
        item.pickupCode.slice(0, 4).toLowerCase() +
        "-" +
        item.pickupCode.slice(4).toLowerCase(),
    },
  });
  assert.equal(success.statusCode, 200, success.body);
  assert.equal(success.json().content, "内容");
  assert.equal(success.json().pin, undefined);
  assert.equal(success.json().code, undefined);
  assert.equal(success.headers["cache-control"], "no-store");
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/pickup/invalid/files/invalid/download",
        headers: owner,
        payload: { code: item.pickupCode },
      })
    ).statusCode,
    403,
  );
  for (let i = 0; i < 7; i++)
    await app.inject({
      method: "POST",
      url: "/pickup",
      headers: owner,
      payload: { code: "ZZZZZZZZ" },
    });
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/pickup",
        headers: owner,
        payload: { code: item.pickupCode },
      })
    ).statusCode,
    429,
  );
});

test("owner and code downloads share a strict grant counter and bind files to the authorized transfer", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "toolnest-pickup-"));
  const store = new TransferStore(dir);
  const settings = new SettingsStore(dir);
  await settings.load();
  const app = Fastify();
  registerRoutes(app, store, settings, new Set());
  t.after(async () => {
    await app.close();
    store.close();
    assert.ok(
      dir.startsWith(path.resolve(os.tmpdir()) + path.sep + "toolnest-pickup-"),
    );
    await rm(dir, { recursive: true, force: true });
  });
  const item = store.createFiles("1", "文件", Date.now() + 60000, 2);
  const file = await app.inject({
    method: "POST",
    url: `/transfers/${item.id}/files`,
    headers: owner,
    payload: { filename: "empty.txt", size: 0, clientId: randomUUID() },
  });
  assert.equal(file.statusCode, 201, file.body);
  const fileId = file.json().id;
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/transfers/${item.id}/publish`,
        headers: owner,
        payload: {},
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/transfers/${item.id}/files/${fileId}/download`,
        headers: { "x-toolnest-user-id": "2" },
        payload: {},
      })
    ).statusCode,
    404,
  );
  const first = await app.inject({
    method: "POST",
    url: `/pickup/${item.id}/files/${fileId}/download`,
    headers: { "x-toolnest-user-id": "2" },
    payload: { code: item.pickupCode },
  });
  assert.equal(first.statusCode, 200, first.body);
  const second = await app.inject({
    method: "POST",
    url: `/transfers/${item.id}/files/${fileId}/download`,
    headers: owner,
    payload: {},
  });
  assert.equal(second.statusCode, 200, second.body);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/public/${item.id}/files/${fileId}/download`,
        payload: { code: item.code },
      })
    ).statusCode,
    403,
  );
  assert.equal(store.resolvePickup(item.pickupCode), null);
  assert.equal(store.ownedContent("1", item.id), null);
});

test("one pickup supports downloading more than eight attachments without exhausting the lookup limit",async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),"toolnest-pickup-"));const store=new TransferStore(dir);const settings=new SettingsStore(dir);await settings.load();const app=Fastify();registerRoutes(app,store,settings,new Set());
 t.after(async()=>{await app.close();store.close();assert.ok(dir.startsWith(path.resolve(os.tmpdir())+path.sep+"toolnest-pickup-"));await rm(dir,{recursive:true,force:true})});
 const item=store.createFiles("1","多附件",Date.now()+60000,null);const files:string[]=[];
 for(let i=0;i<9;i++){const r=await app.inject({method:"POST",url:`/transfers/${item.id}/files`,headers:owner,payload:{filename:`${i}.txt`,size:0,clientId:randomUUID()}});assert.equal(r.statusCode,201);files.push(r.json().id)}
 assert.ok(store.publish("1",item.id));
 for(const file of files){const r=await app.inject({method:"POST",url:`/pickup/${item.id}/files/${file}/download`,headers:owner,payload:{code:item.pickupCode}});assert.equal(r.statusCode,200,r.body)}
 assert.equal((await app.inject({method:"POST",url:"/pickup",headers:owner,payload:{code:item.pickupCode}})).statusCode,200);
});
