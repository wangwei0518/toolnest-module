import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { defaultSettings, type AnimeSettings, type StoreState } from "./types.js";

const clone = <T>(value: T): T => structuredClone(value);

export interface AnimeStoreRepository {
  init(): Promise<void>;
  read(): Readonly<StoreState>;
  snapshot(): StoreState;
  update(mutator: (state: StoreState) => void): Promise<void>;
  saveSettings(settings: AnimeSettings): Promise<AnimeSettings>;
  close(): Promise<void>;
}

export class JsonStore {
  private readonly statePath: string;
  private state: StoreState = this.emptyState();
  private writeQueue = Promise.resolve();

  constructor(private readonly dataDir: string) {
    this.statePath = path.join(dataDir, "anime-calendar-state.json");
  }

  async init() {
    await mkdir(this.dataDir, { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.statePath, "utf8")) as Partial<StoreState>;
      this.state = this.normalize(parsed);
    } catch {
      this.state = this.emptyState();
    }
  }

  snapshot() {
    return clone(this.state);
  }

  read(): Readonly<StoreState> {
    return this.state;
  }

  async update(mutator: (state: StoreState) => void) {
    const next = this.snapshot();
    mutator(next);
    this.state = this.normalize(next);
    this.writeQueue = this.writeQueue.then(() => this.persist());
    await this.writeQueue;
  }

  async saveSettings(settings: AnimeSettings) {
    await this.update((state) => { state.settings = clone(settings); });
    return clone(settings);
  }

  async close(): Promise<void> {}

  private async persist() {
    const temp = `${this.statePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, JSON.stringify(this.state, null, 2), "utf8");
    await rename(temp, this.statePath);
  }

  private normalize(state: Partial<StoreState>): StoreState {
    const defaults = this.emptyState();
    return {
      ...defaults,
      ...state,
      items: Array.isArray(state.items) ? state.items : [],
      marks: state.marks && typeof state.marks === "object" ? state.marks : {},
      courCaches: state.courCaches && typeof state.courCaches === "object" ? state.courCaches : {},
      weeklyCache: state.weeklyCache ?? null,
      todayCache: state.todayCache ?? null,
      longRunningCache: state.longRunningCache ?? null,
      detailCache: state.detailCache && typeof state.detailCache === "object" ? state.detailCache : {},
      settings: mergeSettings(state.settings),
      notificationHistory: state.notificationHistory && typeof state.notificationHistory === "object" ? state.notificationHistory : {},
    };
  }

  private emptyState(): StoreState {
    return {
      items: [], marks: {}, courCaches: {}, weeklyCache: null, todayCache: null,
      longRunningCache: null, detailCache: {}, settings: clone(defaultSettings), notificationHistory: {},
    };
  }
}

export function mergeSettings(value?: Partial<AnimeSettings>): AnimeSettings {
  const source = value ?? {};
  return {
    ...clone(defaultSettings),
    ...source,
    proxy: { ...defaultSettings.proxy, ...(source.proxy ?? {}) },
    notifications: {
      courRelease: { ...defaultSettings.notifications.courRelease, ...(source.notifications?.courRelease ?? {}) },
      watchingUpdate: { ...defaultSettings.notifications.watchingUpdate, ...(source.notifications?.watchingUpdate ?? {}) },
    },
  };
}
