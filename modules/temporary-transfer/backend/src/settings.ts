import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { R2Config } from "./r2.js";

export interface TransferSettings {
  defaultHours: number;
  maxHours: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxConcurrentUploads: number;
  defaultMaxGrants: number | null;
  maxGrantsAllowed: number;
  r2: R2Config | null;
}

const defaults: TransferSettings = {
  defaultHours: 24, maxHours: 168, maxFileBytes: 512 * 1024 * 1024,
  maxTotalBytes: 5 * 1024 * 1024 * 1024, maxConcurrentUploads: 2, defaultMaxGrants: null, maxGrantsAllowed: 10_000, r2: null,
};

/** This file is private module runtime data and is never included in a release. */
export class SettingsStore {
  private readonly filename: string;
  private value: TransferSettings = structuredClone(defaults);
  constructor(dataDir: string) { this.filename = path.join(dataDir, "settings.json"); }

  async load() {
    try {
      this.value = validate(JSON.parse(await readFile(this.filename, "utf8")) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  get() { return this.value; }

  publicValue() {
    const { r2, ...limits } = this.value;
    return { ...limits, storageBackend: r2 ? "r2" : "local", r2: r2 ? { accountId: r2.accountId, bucket: r2.bucket, configured: true } : { configured: false } };
  }

  async save(value: unknown) {
    const next = validate(value);
    const temporary = `${this.filename}.${randomBytes(8).toString("hex")}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(next), { encoding: "utf8", mode: 0o600, flag: "wx" });
      await rename(temporary, this.filename);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
    this.value = next;
  }
}

function validate(input: unknown): TransferSettings {
  if (!input || typeof input !== "object") throw new Error("配置格式无效");
  const raw = input as Record<string, unknown>;
  const number = (key: string, min: number, max: number) => {
    const value = raw[key];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${key} 超出允许范围`);
    return value;
  };
  const defaultHours = number("defaultHours", 1, 720);
  const maxHours = number("maxHours", 1, 720);
  if (defaultHours > maxHours) throw new Error("默认期限不能超过最大期限");
  const maxFileBytes = number("maxFileBytes", 1, 5 * 1024 ** 3);
  const maxTotalBytes = number("maxTotalBytes", 1, 1024 ** 4);
  if (maxFileBytes > maxTotalBytes) throw new Error("单文件上限不能超过总容量");
  const maxConcurrentUploads = number("maxConcurrentUploads", 1, 8);
  const maxGrantsAllowed = raw.maxGrantsAllowed === undefined ? defaults.maxGrantsAllowed : number("maxGrantsAllowed", 1, 10_000);
  const defaultMaxGrants = raw.defaultMaxGrants == null ? null : number("defaultMaxGrants", 1, maxGrantsAllowed);
  let r2: R2Config | null = null;
  if (raw.r2 !== null) {
    if (!raw.r2 || typeof raw.r2 !== "object") throw new Error("R2 配置无效");
    const value = raw.r2 as Record<string, unknown>;
    if (typeof value.accountId !== "string" || !/^[a-f0-9]{32}$/.test(value.accountId) ||
        typeof value.bucket !== "string" || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(value.bucket) ||
        typeof value.accessKeyId !== "string" || !value.accessKeyId.trim() ||
        typeof value.secretAccessKey !== "string" || !value.secretAccessKey.trim()) throw new Error("R2 凭证或存储桶配置无效");
    r2 = { accountId: value.accountId, bucket: value.bucket, accessKeyId: value.accessKeyId, secretAccessKey: value.secretAccessKey };
  }
  return { defaultHours, maxHours, maxFileBytes, maxTotalBytes, maxConcurrentUploads, defaultMaxGrants, maxGrantsAllowed, r2 };
}
