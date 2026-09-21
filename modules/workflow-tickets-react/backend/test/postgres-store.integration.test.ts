import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PostgresStore } from "../src/postgres-store.js";
import { emptyStore, nowIso } from "../src/types.js";

const databaseUrl = process.env.TEST_TOOLNEST_PLUGIN_DATABASE_URL;
const schema = `workflow_store_test_${process.pid}`;
const describeDatabase = databaseUrl ? describe : describe.skip;
let directory = "";

describeDatabase("PostgresStore", () => {
  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "workflow-postgres-store-"));
    const admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  });

  afterAll(async () => {
    const admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
    await rm(directory, { recursive: true, force: true });
  });

  it("creates a missing schema, imports the legacy JSON once, and persists entity changes incrementally", async () => {
    const legacy = emptyStore();
    const createdAt = nowIso();
    legacy.projects.push({
      id: "project-1", key: "DEMO", name: "迁移前", description: "", goal: "", status: "active",
      owner_name: "admin", tags: [], note: "", created_at: createdAt, updated_at: createdAt,
    });
    await writeFile(path.join(directory, "workflow-store.json"), JSON.stringify(legacy), "utf8");

    const first = new PostgresStore(directory, databaseUrl!, schema);
    const imported = await first.init();
    expect(imported.projects).toHaveLength(1);
    imported.projects[0]!.name = "迁移后";
    await first.save();
    await first.close();
    await unlink(path.join(directory, "workflow-store.json"));

    const second = new PostgresStore(directory, databaseUrl!, schema);
    const restored = await second.init();
    expect(restored.projects[0]?.name).toBe("迁移后");
    await second.close();
  });
});
