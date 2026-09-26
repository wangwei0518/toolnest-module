import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { WallpaperFormat, WallpaperRecord } from "./types.js";

const ownerPattern = /^[A-Za-z0-9_-]{1,128}$/;
const idPattern = /^[0-9a-f-]{36}$/i;

function sourceExtension(format: WallpaperFormat): string {
  return format === "jpg" ? "jpg" : format;
}

export class WallpaperStorage {
  private readonly chains = new Map<string, Promise<void>>();

  constructor(private readonly dataDir: string) {}

  userDirectory(ownerId: string): string {
    if (!ownerPattern.test(ownerId)) throw new Error("无效的用户标识。");
    return path.join(this.dataDir, "users", ownerId);
  }

  async listOwners(): Promise<string[]> {
    const root = path.join(this.dataDir, "users");
    const entries = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    return entries
      .filter((entry) => entry.isDirectory() && ownerPattern.test(entry.name))
      .map((entry) => entry.name);
  }

  async list(ownerId: string): Promise<WallpaperRecord[]> {
    return this.readIndex(ownerId);
  }

  async get(ownerId: string, wallpaperId: string): Promise<WallpaperRecord | undefined> {
    this.assertId(wallpaperId);
    return (await this.readIndex(ownerId)).find((record) => record.id === wallpaperId);
  }

  async create(ownerId: string, record: WallpaperRecord): Promise<void> {
    await this.mutate(ownerId, (records) => {
      records.unshift(record);
    });
  }

  async update(
    ownerId: string,
    wallpaperId: string,
    update: (record: WallpaperRecord) => void,
  ): Promise<WallpaperRecord | undefined> {
    this.assertId(wallpaperId);
    return this.mutate(ownerId, (records) => {
      const record = records.find((item) => item.id === wallpaperId);
      if (!record) return undefined;
      update(record);
      return record;
    });
  }

  async delete(ownerId: string, wallpaperId: string): Promise<boolean> {
    this.assertId(wallpaperId);
    const removed = await this.mutate(ownerId, (records) => {
      const index = records.findIndex((item) => item.id === wallpaperId);
      if (index < 0) return false;
      records.splice(index, 1);
      return true;
    });
    if (removed) {
      await rm(path.join(this.userDirectory(ownerId), wallpaperId), {
        recursive: true,
        force: true,
      });
    }
    return removed;
  }

  sourcePath(ownerId: string, record: WallpaperRecord): string {
    this.assertId(record.id);
    return path.join(
      this.userDirectory(ownerId),
      record.id,
      `source.${sourceExtension(record.format)}`,
    );
  }

  motionVideoPath(ownerId: string, record: WallpaperRecord): string {
    this.assertId(record.id);
    const key = record.motionVideoKey;
    if (!key || !idPattern.test(key)) throw new Error("动态照片视频标识无效。");
    return path.join(this.userDirectory(ownerId), record.id, `${key}.mp4`);
  }

  exportPath(ownerId: string, record: WallpaperRecord): string {
    this.assertId(record.id);
    return path.join(
      this.userDirectory(ownerId),
      record.id,
      `wallpaper.${record.motionPhoto ? "jpg" : record.format === "gif" ? "gif" : "png"}`,
    );
  }

  previewPath(ownerId: string, record: WallpaperRecord): string {
    this.assertId(record.id);
    return path.join(this.userDirectory(ownerId), record.id, "preview.webp");
  }

  private async readIndex(ownerId: string): Promise<WallpaperRecord[]> {
    const indexPath = path.join(this.userDirectory(ownerId), "wallpapers.json");
    try {
      const parsed: unknown = JSON.parse(await readFile(indexPath, "utf8"));
      if (!Array.isArray(parsed)) throw new Error("作品索引格式错误。");
      return parsed.filter(
        (entry): entry is WallpaperRecord =>
          Boolean(entry) &&
          typeof entry === "object" &&
          "id" in entry &&
          typeof entry.id === "string" &&
          idPattern.test(entry.id),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private async mutate<T>(ownerId: string, action: (records: WallpaperRecord[]) => T): Promise<T> {
    const previous = this.chains.get(ownerId) ?? Promise.resolve();
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => hold);
    this.chains.set(ownerId, queued);
    await previous;

    try {
      const directory = this.userDirectory(ownerId);
      await mkdir(directory, { recursive: true });
      const records = await this.readIndex(ownerId);
      const result = action(records);
      const temporaryPath = path.join(directory, `wallpapers.${randomUUID()}.tmp`);
      await writeFile(temporaryPath, JSON.stringify(records, null, 2), "utf8");
      await rename(temporaryPath, path.join(directory, "wallpapers.json"));
      return result;
    } finally {
      release();
      if (this.chains.get(ownerId) === queued) this.chains.delete(ownerId);
    }
  }

  private assertId(value: string): void {
    if (!idPattern.test(value)) throw new Error("无效的作品标识。");
  }
}
