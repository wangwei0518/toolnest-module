import type { LocalStorage } from "./local-storage.js";
import type { SettingsStore } from "./settings.js";
import type { TransferStore } from "./store.js";
import { selectStorage } from "./storage.js";

export class CleanupError extends Error {
  constructor(step: string, cause: unknown) {
    super(`${step}（${cleanupErrorCode(cause)}）`);
  }
}

function cleanupErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return "未知错误";
  const { code, errcode } = error as NodeJS.ErrnoException & { errcode?: number };
  if (code === "ERR_SQLITE_ERROR" && typeof errcode === "number") {
    switch (errcode & 0xff) {
      case 5: return `SQLITE_BUSY/${errcode}`;
      case 6: return `SQLITE_LOCKED/${errcode}`;
      case 8: return `SQLITE_READONLY/${errcode}`;
      case 10: return `SQLITE_IOERR/${errcode}`;
      case 11: return `SQLITE_CORRUPT/${errcode}`;
      case 13: return `SQLITE_FULL/${errcode}`;
      default: return `SQLite/${errcode}`;
    }
  }
  return code && /^[A-Z][A-Z0-9_]{1,40}$/.test(code) ? code : "未知错误";
}

function cleanupStep<T>(step: string, action: () => T): T {
  try { return action(); }
  catch (error) { throw new CleanupError(step, error); }
}

export async function cleanupTransfers(store: TransferStore, settings: SettingsStore, initializing: Set<string>, local: LocalStorage) {
  cleanupStep("清除失效投递内容", () => store.purgeExpiredText());
  const candidates = cleanupStep("查询待清理文件", () => store.cleanupCandidates());
  for (const file of candidates) {
    if (initializing.has(file.id)) continue;
    try {
      const storage = selectStorage(file.storage_backend, settings, local);
      if (file.upload_id && file.upload_id !== "single-empty") {
        try { await storage.abort(file.object_key, file.upload_id); }
        catch (error) { if (!(error instanceof Error) || error.name !== "NoSuchUpload") throw error; }
      }
      await storage.remove(file.object_key);
      cleanupStep("删除已清理文件的记录", () => store.forgetFile(file.id));
    } catch (error) {
      const reason = error instanceof CleanupError ? error.message : cleanupErrorCode(error);
      console.warn(`临时投递文件 ${file.id} 清理失败（${file.storage_backend}：${reason}），将稍后重试`);
      cleanupStep("保存文件清理失败状态", () => store.markCleanupFailure(file.id));
    }
  }
}
