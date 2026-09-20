import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Pool, type PoolClient } from "pg";

import type { WorkflowStoreRepository } from "./store.js";
import { emptyStore, type WorkflowStore } from "./types.js";

const ARRAY_COLLECTIONS = [
  "workflows", "tickets", "timeline", "projects", "milestones", "schedule_items",
  "schedules", "schedule_runs", "saved_views", "automations", "resources", "attachments",
  "temporary_resources", "action_executions",
] as const satisfies ReadonlyArray<keyof WorkflowStore>;

type ArrayCollection = typeof ARRAY_COLLECTIONS[number];
type Entity = { id: string } & Record<string, unknown>;

export interface WorkflowHistoryLimits {
  timeline: number;
  actionExecutions: number;
  scheduleRuns: number;
}

export function pruneWorkflowHistory(state: WorkflowStore, limits: WorkflowHistoryLimits): void {
  state.timeline = state.timeline
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .slice(0, limits.timeline);
  state.action_executions = state.action_executions
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .slice(0, limits.actionExecutions);
  state.schedule_runs = state.schedule_runs
    .sort((left, right) => right.executed_at.localeCompare(left.executed_at))
    .slice(0, limits.scheduleRuns);
}

function normalize(value: Partial<WorkflowStore>): WorkflowStore {
  const initial = emptyStore();
  return {
    ...initial,
    ...value,
    schema_version: 3,
    settings: {
      ...initial.settings,
      ...(value.settings ?? {}),
      notification_rules: {
        ...initial.settings.notification_rules,
        ...(value.settings?.notification_rules ?? {}),
      },
    },
    workflows: value.workflows ?? [],
    tickets: value.tickets ?? [],
    timeline: value.timeline ?? [],
    projects: value.projects ?? [],
    milestones: value.milestones ?? [],
    schedule_items: value.schedule_items ?? [],
    schedules: value.schedules ?? [],
    schedule_runs: value.schedule_runs ?? [],
    saved_views: value.saved_views ?? [],
    automations: value.automations ?? [],
    resources: value.resources ?? [],
    attachments: value.attachments ?? [],
    temporary_resources: value.temporary_resources ?? [],
    action_executions: value.action_executions ?? [],
  };
}

export class PostgresStore implements WorkflowStoreRepository {
  readonly dataDir: string;
  private readonly pool: Pool;
  private data: WorkflowStore | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  private readonly persisted = new Map<string, string>();

  constructor(
    dataDir: string,
    databaseUrl: string,
    databaseSchema: string,
    poolMax = 2,
    private readonly historyLimits: WorkflowHistoryLimits = { timeline: 5_000, actionExecutions: 2_000, scheduleRuns: 2_000 },
  ) {
    this.dataDir = dataDir;
    this.pool = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${databaseSchema}`,
      max: poolMax,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }

  async init(): Promise<WorkflowStore> {
    await this.migrate();
    const rows = await this.pool.query<{ collection: ArrayCollection; payload: Entity }>(
      "SELECT collection, payload FROM workflow_tickets_entities ORDER BY collection, ordinal",
    );
    const settings = await this.pool.query<{ payload: WorkflowStore["settings"] }>(
      "SELECT payload FROM workflow_tickets_settings WHERE singleton = TRUE",
    );
    if (rows.rowCount === 0 && settings.rowCount === 0) {
      const legacy = await this.readLegacyState();
      this.data = legacy ?? emptyStore();
      await this.persist(this.data, true);
    } else {
      const restored = emptyStore();
      for (const row of rows.rows) {
        const collection = restored[row.collection] as unknown as Entity[];
        collection.push(row.payload);
      }
      if (settings.rows[0]) restored.settings = settings.rows[0].payload;
      this.data = normalize(restored);
      this.capturePersisted(this.data);
      const before = this.data.timeline.length + this.data.action_executions.length + this.data.schedule_runs.length;
      pruneWorkflowHistory(this.data, this.historyLimits);
      const after = this.data.timeline.length + this.data.action_executions.length + this.data.schedule_runs.length;
      if (after < before) await this.persist(this.data, false);
    }
    return this.data;
  }

  get(): WorkflowStore {
    if (!this.data) throw new Error("数据仓库尚未初始化");
    return this.data;
  }

  async save(): Promise<void> {
    const state = this.get();
    this.writeQueue = this.writeQueue.then(() => this.persist(state, false));
    return this.writeQueue;
  }

  async close(): Promise<void> {
    await this.writeQueue;
    await this.pool.end();
  }

  private async migrate(): Promise<void> {
    const migrationPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../prisma/migrations/001_workflow_store.sql");
    const migration = await readFile(migrationPath, "utf8");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(migration);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async readLegacyState(): Promise<WorkflowStore | null> {
    try {
      const raw = await readFile(path.join(this.dataDir, "workflow-store.json"), "utf8");
      return normalize(JSON.parse(raw) as Partial<WorkflowStore>);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private async persist(state: WorkflowStore, force: boolean): Promise<void> {
    pruneWorkflowHistory(state, this.historyLimits);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const collection of ARRAY_COLLECTIONS) {
        await this.persistCollection(client, collection, state[collection] as unknown as Entity[], force);
      }
      const settingsJson = JSON.stringify(state.settings);
      if (force || this.persisted.get("settings") !== settingsJson) {
        await client.query(
          `INSERT INTO workflow_tickets_settings(singleton, payload, updated_at)
           VALUES (TRUE, $1::jsonb, NOW())
           ON CONFLICT (singleton) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
          [settingsJson],
        );
        this.persisted.set("settings", settingsJson);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async persistCollection(client: PoolClient, collection: ArrayCollection, entities: Entity[], force: boolean): Promise<void> {
    const ids = entities.map((entity) => entity.id);
    const changedIds: string[] = [];
    const ordinals: number[] = [];
    const payloads: string[] = [];
    entities.forEach((entity, ordinal) => {
      const json = JSON.stringify(entity);
      const key = `${collection}:${entity.id}`;
      if (force || this.persisted.get(key) !== `${ordinal}:${json}`) {
        changedIds.push(entity.id);
        ordinals.push(ordinal);
        payloads.push(json);
      }
    });
    if (changedIds.length) {
      await client.query(
        `INSERT INTO workflow_tickets_entities(collection, entity_id, ordinal, payload, updated_at)
         SELECT $1, item.entity_id, item.ordinal, item.payload, NOW()
         FROM UNNEST($2::text[], $3::integer[], $4::jsonb[]) AS item(entity_id, ordinal, payload)
         ON CONFLICT (collection, entity_id) DO UPDATE
         SET ordinal = EXCLUDED.ordinal, payload = EXCLUDED.payload, updated_at = NOW()`,
        [collection, changedIds, ordinals, payloads],
      );
    }
    await client.query(
      "DELETE FROM workflow_tickets_entities WHERE collection = $1 AND NOT (entity_id = ANY($2::text[]))",
      [collection, ids],
    );
    const activeIds = new Set(ids);
    for (const [key] of this.persisted) {
      if (key.startsWith(`${collection}:`) && !activeIds.has(key.slice(collection.length + 1))) this.persisted.delete(key);
    }
    entities.forEach((entity, ordinal) => this.persisted.set(`${collection}:${entity.id}`, `${ordinal}:${JSON.stringify(entity)}`));
  }

  private capturePersisted(state: WorkflowStore): void {
    for (const collection of ARRAY_COLLECTIONS) {
      for (const [ordinal, entity] of (state[collection] as unknown as Entity[]).entries()) {
        this.persisted.set(`${collection}:${entity.id}`, `${ordinal}:${JSON.stringify(entity)}`);
      }
    }
    this.persisted.set("settings", JSON.stringify(state.settings));
  }
}
