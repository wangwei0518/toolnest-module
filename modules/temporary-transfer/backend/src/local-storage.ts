import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readdir, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

type UploadClaim = { op: "upload"; key: string; uploadId: string; part: number; size: number; expires: number };
type DownloadClaim = { op: "download"; key: string; expires: number };
type Claim = UploadClaim | DownloadClaim;
const apiBase = "/api/v1/modules/temporary-transfer/public";
const missingUpload = () => Object.assign(new Error("上传会话不存在"), { name: "NoSuchUpload" });

/** Private runtime files; only scoped, short-lived bearer URLs expose their bytes. */
export class LocalStorage {
  private readonly root: string;
  private readonly secret: Buffer;
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(dataDir: string) {
    this.root = path.resolve(dataDir, "local-files");
    const secretPath = path.join(dataDir, "local-signing-key");
    try { this.secret = readFileSync(secretPath); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const value = randomBytes(32);
      try { writeFileSync(secretPath, value, { flag: "wx", mode: 0o600 }); this.secret = value; }
      catch (writeError) {
        if ((writeError as NodeJS.ErrnoException).code !== "EEXIST") throw writeError;
        this.secret = readFileSync(secretPath);
      }
    }
    if (this.secret.length !== 32) throw new Error("本地存储密钥无效");
  }

  private directory(key: string) { return path.join(this.root, createHash("sha256").update(key).digest("hex")); }
  objectPath(key: string) { return path.join(this.directory(key), "object"); }
  private uploadPath(key: string, uploadId: string) {
    if (!/^[a-f0-9]{32}$/.test(uploadId)) throw missingUpload();
    return path.join(this.directory(key), "uploads", uploadId);
  }

  private async locked<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(action);
    this.locks.set(key, current);
    try { return await current; }
    finally { if (this.locks.get(key) === current) this.locks.delete(key); }
  }

  private sign(claim: Claim) {
    const payload = Buffer.from(JSON.stringify(claim)).toString("base64url");
    const signature = createHmac("sha256", this.secret).update(payload).digest("base64url");
    return `${payload}.${signature}`;
  }

  verify(token: string): Claim | null {
    if (token.length > 2048) return null;
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra !== undefined) return null;
    const expected = createHmac("sha256", this.secret).update(payload).digest();
    const actual = Buffer.from(signature, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    try {
      const claim = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Claim;
      if (typeof claim.key !== "string" || !Number.isSafeInteger(claim.expires) || claim.expires <= Date.now()) return null;
      if (claim.op === "download") return claim;
      if (claim.op !== "upload" || !/^[a-f0-9]{32}$/.test(claim.uploadId) || !Number.isSafeInteger(claim.part) || claim.part < 1 || claim.part > 10000 || !Number.isSafeInteger(claim.size) || claim.size < 1 || claim.size > 5 * 1024 * 1024) return null;
      return claim;
    } catch { return null; }
  }

  async start(key: string, _filename: string) {
    const id = randomBytes(16).toString("hex");
    await mkdir(this.uploadPath(key, id), { recursive: true, mode: 0o700 });
    return id;
  }

  async putEmpty(key: string, _filename: string) {
    await this.locked(key, async () => {
      await mkdir(this.directory(key), { recursive: true, mode: 0o700 });
      await writeFile(this.objectPath(key), Buffer.alloc(0), { mode: 0o600 });
    });
  }

  async signPart(key: string, uploadId: string, part: number, size: number) {
    return `${apiBase}/local-upload?token=${this.sign({ op: "upload", key, uploadId, part, size, expires: Date.now() + 300_000 })}`;
  }

  async putPart(claim: UploadClaim, bytes: Buffer, isActive: () => boolean) {
    if (bytes.length !== claim.size) throw new Error("上传分片大小不匹配");
    await this.locked(claim.key, async () => {
      if (!isActive()) throw new Error("投递已失效");
      const directory = this.uploadPath(claim.key, claim.uploadId);
      const temporary = path.join(directory, `${claim.part}.${randomBytes(8).toString("hex")}.tmp`);
      try {
        await writeFile(temporary, bytes, { mode: 0o600, flag: "wx" });
        await rename(temporary, path.join(directory, `${claim.part}.part`));
      } finally { await rm(temporary, { force: true }); }
    });
    return `"${createHash("md5").update(bytes).digest("hex")}"`;
  }

  async parts(key: string, uploadId: string) {
    let names: string[];
    const directory = this.uploadPath(key, uploadId);
    try { names = await readdir(directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw missingUpload(); throw error; }
    const result: Array<{ PartNumber: number; ETag: string; Size: number }> = [];
    for (const name of names.filter((value) => /^[1-9]\d{0,4}\.part$/.test(value) && parseInt(value) <= 10000).sort((a, b) => parseInt(a) - parseInt(b))) {
      const file = path.join(directory, name);
      const hash = createHash("md5");
      for await (const chunk of createReadStream(file)) hash.update(chunk);
      result.push({ PartNumber: parseInt(name), ETag: `"${hash.digest("hex")}"`, Size: (await stat(file)).size });
    }
    return result;
  }

  async complete(key: string, uploadId: string, expectedSize: number, partSize: number) {
    await this.locked(key, async () => {
      if (await this.hasCompletedObject(key, expectedSize)) return;
      const parts = await this.parts(key, uploadId);
      const count = Math.ceil(expectedSize / partSize);
      if (parts.length !== count || parts.some((part, index) => part.PartNumber !== index + 1 || part.Size !== Math.min(partSize, expectedSize - index * partSize))) throw new Error("上传分片不完整或大小不匹配");
      const directory = this.uploadPath(key, uploadId);
      const disk = await statfs(directory);
      if (disk.bavail * disk.bsize < expectedSize) throw Object.assign(new Error("服务器磁盘空间不足"), { code: "ENOSPC" });
      const temporary = path.join(this.directory(key), `object.${randomBytes(8).toString("hex")}.tmp`);
      try {
        async function* chunks() {
          for (const part of parts) for await (const chunk of createReadStream(path.join(directory, `${part.PartNumber}.part`))) yield chunk;
        }
        await pipeline(Readable.from(chunks()), createWriteStream(temporary, { mode: 0o600, flags: "wx" }));
        if ((await stat(temporary)).size !== expectedSize) throw new Error("上传完成后的文件大小不匹配");
        await rename(temporary, this.objectPath(key));
        await rm(directory, { recursive: true, force: true });
      } finally { await rm(temporary, { force: true }); }
    });
  }

  async hasCompletedObject(key: string, expectedSize: number) {
    try { return (await stat(this.objectPath(key))).size === expectedSize; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  }
  async abort(key: string, uploadId: string) { await this.locked(key, () => rm(this.uploadPath(key, uploadId), { recursive: true, force: true })); }
  async remove(key: string) { await this.locked(key, () => rm(this.directory(key), { recursive: true, force: true })); }
  async download(key: string) { return `${apiBase}/local-download?token=${this.sign({ op: "download", key, expires: Date.now() + 120_000 })}`; }
}
