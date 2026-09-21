import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Pool, type PoolClient } from "pg";

import { mergeSettings, type AnimeStoreRepository } from "./store.js";
import { defaultSettings, type AnimeMarkType, type AnimeSettings, type StoreState } from "./types.js";

type StoredEntity = { collection: string; entity_id: string; ordinal: number; payload: unknown };

const MAX_COUR_CACHES = 24;
const MAX_DETAIL_CACHE_ENTRIES = 500;
const MAX_NOTIFICATION_HISTORY_ENTRIES = 2_000;

const clone = <T>(value: T): T => structuredClone(value);

function emptyState(): StoreState {
  return {
    items: [], marks: {}, courCaches: {}, weeklyCache: null, todayCache: null,
    longRunningCache: null, detailCache: {}, settings: clone(defaultSettings), notificationHistory: {},
  };
}

function normalize(state: Partial<StoreState>): StoreState {
  const defaults = emptyState();
  const normalized = {
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
  pruneAnimeCaches(normalized);
  return normalized;
}

function newestEntries<T>(entries: Array<[string, T]>, limit: number, timestamp: (value: T) => string | number): Record<string, T> {
  return Object.fromEntries(entries.sort(([, left], [, right]) => Date.parse(String(timestamp(right))) - Date.parse(String(timestamp(left)))).slice(0, limit));
}

export function pruneAnimeCaches(state: StoreState): void {
  const retentionDays = state.settings.cacheRetentionDays;
  const cutoff = retentionDays > 0 ? Date.now() - retentionDays * 86_400_000 : Number.NEGATIVE_INFINITY;
  state.detailCache = newestEntries(
    Object.entries(state.detailCache).filter(([, value]) => Date.parse(value.cached_at) >= cutoff),
    MAX_DETAIL_CACHE_ENTRIES,
    (value) => value.cached_at,
  );
  state.notificationHistory = newestEntries(
    Object.entries(state.notificationHistory),
    MAX_NOTIFICATION_HISTORY_ENTRIES,
    (value) => value.sent_at,
  );
  state.courCaches = Object.fromEntries(
    Object.entries(state.courCaches)
      .sort(([, left], [, right]) => (right.year * 12 + right.cour_month) - (left.year * 12 + left.cour_month))
      .slice(0, MAX_COUR_CACHES),
  );
}

export class PostgresStore implements AnimeStoreRepository {
  private readonly pool: Pool;
  private state: StoreState = emptyState();
  private writeQueue: Promise<void> = Promise.resolve();
  private readonly persisted = new Map<string, string>();

  constructor(private readonly dataDir: string, databaseUrl: string, private readonly databaseSchema: string, poolMax = 2) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${databaseSchema}`,
      max: poolMax,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }

  async init(): Promise<void> {
    await this.migrate();
    const result = await this.pool.query<StoredEntity>(
      "SELECT collection, entity_id, ordinal, payload FROM anime_calendar_entities ORDER BY collection, ordinal",
    );
    if (result.rowCount === 0) {
      this.state = await this.readLegacyState() ?? emptyState();
      await this.persist(this.state, true);
      return;
    }
    const restored = emptyState();
    for (const row of result.rows) {
      if (row.collection === "items") restored.items.push(row.payload as StoreState["items"][number]);
      else if (row.collection === "marks") restored.marks[row.entity_id] = row.payload as AnimeMarkType;
      else if (row.collection === "cour_caches") restored.courCaches[row.entity_id] = row.payload as StoreState["courCaches"][string];
      else if (row.collection === "detail_cache") restored.detailCache[row.entity_id] = row.payload as StoreState["detailCache"][string];
      else if (row.collection === "notification_history") restored.notificationHistory[row.entity_id] = row.payload as StoreState["notificationHistory"][string];
      else if (row.collection === "singleton") {
        if (row.entity_id === "settings") restored.settings = row.payload as AnimeSettings;
        else if (row.entity_id === "weekly_cache") restored.weeklyCache = row.payload as StoreState["weeklyCache"];
        else if (row.entity_id === "today_cache") restored.todayCache = row.payload as StoreState["todayCache"];
        else if (row.entity_id === "long_running_cache") restored.longRunningCache = row.payload as StoreState["longRunningCache"];
      }
    }
    this.state = normalize(restored);
    this.capturePersisted(this.state);
  }

  snapshot(): StoreState {
    return clone(this.state);
  }

  read(): Readonly<StoreState> {
    return this.state;
  }

  async update(mutator: (state: StoreState) => void): Promise<void> {
    const next = this.snapshot();
    mutator(next);
    this.state = normalize(next);
    this.writeQueue = this.writeQueue.then(() => this.persist(this.state, false));
    await this.writeQueue;
  }

  async saveSettings(settings: AnimeSettings): Promise<AnimeSettings> {
    await this.update((state) => { state.settings = clone(settings); });
    return clone(settings);
  }

  async close(): Promise<void> {
    await this.writeQueue;
    await this.pool.end();
  }

  private async migrate(): Promise<void> {
    const migrationPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../prisma/migrations/001_anime_store.sql");
    const migration = await readFile(migrationPath, "utf8");
    const client = await this.pool.connect();
    const schema = quoteIdentifier(this.databaseSchema);
    try {
      await client.query("BEGIN");
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
      await client.query(`SET LOCAL search_path TO ${schema}`);
      await client.query(migration);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async readLegacyState(): Promise<StoreState | null> {
    try {
      const raw = await readFile(path.join(this.dataDir, "anime-calendar-state.json"), "utf8");
      return normalize(JSON.parse(raw) as Partial<StoreState>);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private entries(state: StoreState): Array<{ collection: string; entityId: string; ordinal: number; payload: unknown }> {
    return [
      ...state.items.map((payload, ordinal) => ({ collection: "items", entityId: payload.id, ordinal, payload })),
      ...Object.entries(state.marks).map(([entityId, payload], ordinal) => ({ collection: "marks", entityId, ordinal, payload })),
      ...Object.entries(state.courCaches).map(([entityId, payload], ordinal) => ({ collection: "cour_caches", entityId, ordinal, payload })),
      ...Object.entries(state.detailCache).map(([entityId, payload], ordinal) => ({ collection: "detail_cache", entityId, ordinal, payload })),
      ...Object.entries(state.notificationHistory).map(([entityId, payload], ordinal) => ({ collection: "notification_history", entityId, ordinal, payload })),
      { collection: "singleton", entityId: "settings", ordinal: 0, payload: state.settings },
      { collection: "singleton", entityId: "weekly_cache", ordinal: 1, payload: state.weeklyCache },
      { collection: "singleton", entityId: "today_cache", ordinal: 2, payload: state.todayCache },
      { collection: "singleton", entityId: "long_running_cache", ordinal: 3, payload: state.longRunningCache },
    ];
  }

  private async persist(state: StoreState, force: boolean): Promise<void> {
    const entries = this.entries(state);
    const activeKeys = new Set(entries.map((entry) => `${entry.collection}:${entry.entityId}`));
    const changed = entries.filter((entry) => force || this.persisted.get(`${entry.collection}:${entry.entityId}`) !== `${entry.ordinal}:${JSON.stringify(entry.payload)}`);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (changed.length) {
        await client.query(
          `INSERT INTO anime_calendar_entities(collection, entity_id, ordinal, payload, updated_at)
           SELECT item.collection, item.entity_id, item.ordinal, item.payload, NOW()
           FROM UNNEST($1::text[], $2::text[], $3::integer[], $4::jsonb[])
             AS item(collection, entity_id, ordinal, payload)
           ON CONFLICT (collection, entity_id) DO UPDATE
           SET ordinal = EXCLUDED.ordinal, payload = EXCLUDED.payload, updated_at = NOW()`,
          [
            changed.map((entry) => entry.collection),
            changed.map((entry) => entry.entityId),
            changed.map((entry) => entry.ordinal),
            changed.map((entry) => JSON.stringify(entry.payload)),
          ],
        );
      }
      const staleKeys = [...this.persisted.keys()].filter((key) => !activeKeys.has(key));
      if (staleKeys.length) {
        await client.query(
          `DELETE FROM anime_calendar_entities
           WHERE (collection || ':' || entity_id) = ANY($1::text[])`,
          [staleKeys],
        );
      }
      await client.query("COMMIT");
      for (const key of staleKeys) this.persisted.delete(key);
      for (const entry of entries) this.persisted.set(`${entry.collection}:${entry.entityId}`, `${entry.ordinal}:${JSON.stringify(entry.payload)}`);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private capturePersisted(state: StoreState): void {
    for (const entry of this.entries(state)) {
      this.persisted.set(`${entry.collection}:${entry.entityId}`, `${entry.ordinal}:${JSON.stringify(entry.payload)}`);
    }
  }
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
