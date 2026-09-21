import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PostgresStore } from "../src/postgres-store.js";
import { defaultSettings, type StoreState } from "../src/types.js";

const databaseUrl = process.env.TEST_TOOLNEST_PLUGIN_DATABASE_URL;
const schema = `anime_store_test_${process.pid}`;
const describeDatabase = databaseUrl ? describe : describe.skip;
let directory = "";

describeDatabase("PostgresStore", () => {
  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "anime-postgres-store-"));
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

  it("creates a missing schema, imports legacy JSON, and restores independently stored entities", async () => {
    const legacy: StoreState = {
      items: [], marks: { "anime-1": "watching" }, courCaches: {}, weeklyCache: null,
      todayCache: null, longRunningCache: null, detailCache: {}, settings: structuredClone(defaultSettings),
      notificationHistory: {},
    };
    await writeFile(path.join(directory, "anime-calendar-state.json"), JSON.stringify(legacy), "utf8");

    const first = new PostgresStore(directory, databaseUrl!, schema);
    await first.init();
    expect(first.snapshot().marks["anime-1"]).toBe("watching");
    await first.update((state) => { state.marks["anime-1"] = "completed"; });
    await first.close();
    await unlink(path.join(directory, "anime-calendar-state.json"));

    const second = new PostgresStore(directory, databaseUrl!, schema);
    await second.init();
    expect(second.snapshot().marks["anime-1"]).toBe("completed");
    await second.close();
  });
});
