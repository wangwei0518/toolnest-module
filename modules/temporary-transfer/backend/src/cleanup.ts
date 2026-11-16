import type { LocalStorage } from "./local-storage.js";
import type { SettingsStore } from "./settings.js";
import type { TransferStore } from "./store.js";
import { selectStorage } from "./storage.js";

export async function cleanupTransfers(store: TransferStore, settings: SettingsStore, initializing: Set<string>, local: LocalStorage) {
  store.purgeExpiredText();
  for (const file of store.cleanupCandidates()) {
    if (initializing.has(file.id)) continue;
    try {
      const storage = selectStorage(file.storage_backend, settings, local);
      if (file.upload_id && file.upload_id !== "single-empty") {
        try { await storage.abort(file.object_key, file.upload_id); }
        catch (error) { if (!(error instanceof Error) || error.name !== "NoSuchUpload") throw error; }
      }
      await storage.remove(file.object_key);
      store.forgetFile(file.id);
    } catch {
      store.markCleanupFailure(file.id);
      console.warn(`临时投递文件 ${file.id} 清理失败，将稍后重试`);
    }
  }
}
