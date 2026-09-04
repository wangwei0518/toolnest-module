import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { emptyStore, type WorkflowStore } from "./types.js";

export class JsonStore {
  readonly filePath: string;
  readonly dataDir: string;
  private data: WorkflowStore | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.filePath = path.join(dataDir, "workflow-store.json");
  }

  async init(): Promise<WorkflowStore> {
    await mkdir(this.dataDir, { recursive: true });
    try {
      const raw = await readFile(this.filePath, "utf8");
      this.data = this.normalize(JSON.parse(raw) as Partial<WorkflowStore>);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.data = emptyStore();
      await this.save();
    }
    return this.data;
  }

  get(): WorkflowStore {
    if (!this.data) throw new Error("数据仓库尚未初始化");
    return this.data;
  }

  async save(): Promise<void> {
    const data = this.get();
    this.writeQueue = this.writeQueue.then(async () => {
      const temporaryPath = `${this.filePath}.tmp`;
      await writeFile(temporaryPath, JSON.stringify(data, null, 2), "utf8");
      await rename(temporaryPath, this.filePath);
    });
    return this.writeQueue;
  }

  private normalize(value: Partial<WorkflowStore>): WorkflowStore {
    const initial = emptyStore();
    return {
      ...initial,
      ...value,
      settings: { ...initial.settings, ...(value.settings ?? {}), notification_rules: { ...initial.settings.notification_rules, ...(value.settings?.notification_rules ?? {}) } },
      workflows: value.workflows ?? [],
      tickets: value.tickets ?? [],
      timeline: value.timeline ?? [],
      projects: value.projects ?? [],
      milestones: value.milestones ?? [],
      inbox_items: value.inbox_items ?? [],
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
}
