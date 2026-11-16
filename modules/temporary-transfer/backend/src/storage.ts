import { LocalStorage } from "./local-storage.js";
import { R2Storage } from "./r2.js";
import type { SettingsStore } from "./settings.js";
import type { StorageBackend } from "./store.js";

export function selectStorage(backend: StorageBackend, settings: SettingsStore, local: LocalStorage) {
  if (backend === "local") return local;
  const config = settings.get().r2;
  if (!config) throw new Error("尚未配置 R2 存储");
  return new R2Storage(config);
}
