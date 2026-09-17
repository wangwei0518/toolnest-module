import { Database } from "./db.js";
import { randomUUID } from "node:crypto";
import { CronExpressionParser } from "cron-parser";
import { ExecutionManager, type ExecutionSource } from "./execution-manager.js";
import { SecurityService } from "./security-service.js";
import type { PythonExecution } from "./types.js";

export interface ScheduleInput {
  name: string;
  description?: string;
  source: ExecutionSource;
  args?: string[];
  timeout_seconds?: number;
  runtime_environment?: "auto" | "project_venv" | "system";
  schedule_type: "cron" | "once";
  cron_expression?: string | null;
  run_at?: string | null;
  timezone?: string;
  enabled?: boolean;
  notification_config?: Record<string, unknown>;
  security?: unknown;
}

export interface ScheduledTask {
  id: string;
  name: string;
  description: string;
  code: string;
  source_type: string;
  source_config: Record<string, unknown>;
  source: ExecutionSource;
  args: string[];
  timeout_seconds: number;
  schedule_type: string;
  cron_expression: string | null;
  run_at: string | null;
  timezone: string;
  enabled: boolean;
  status: string;
  last_execution_id: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
  last_status: string | null;
  total_runs: number;
  success_runs: number;
  failed_runs: number;
  notification_config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export class ScheduleManager {
  private readonly timer: NodeJS.Timeout;
  private ticking = false;

  constructor(
    private readonly db: Database,
    private readonly executions: ExecutionManager,
    private readonly security: SecurityService,
  ) {
    this.timer = setInterval(() => void this.tick(), 15_000);
    this.timer.unref();
    void this.tick();
  }

  async list(
    query: {
      keyword?: string;
      status?: string;
      page?: number;
      page_size?: number;
    } = {},
  ): Promise<{
    items: ScheduledTask[];
    total: number;
    page: number;
    page_size: number;
  }> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.page_size ?? 20));
    const keyword = query.keyword?.trim() || null;
    const status = query.status?.trim() || null;
    const count = await this.db.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM pr_scheduled_tasks WHERE ($1::text IS NULL OR name ILIKE '%' || $1 || '%') AND ($2::text IS NULL OR status = $2)",
      [keyword, status],
    );
    const result = await this.db.query<ScheduleRow>(
      "SELECT * FROM pr_scheduled_tasks WHERE ($1::text IS NULL OR name ILIKE '%' || $1 || '%') AND ($2::text IS NULL OR status = $2) ORDER BY created_at DESC LIMIT $3 OFFSET $4",
      [keyword, status, pageSize, (page - 1) * pageSize],
    );
    return {
      items: result.rows.map(toOutput),
      total: Number(count.rows[0]?.count ?? 0),
      page,
      page_size: pageSize,
    };
  }

  async get(id: string): Promise<ScheduledTask> {
    const result = await this.db.query<ScheduleRow>(
      "SELECT * FROM pr_scheduled_tasks WHERE id = $1",
      [id],
    );
    if (!result.rows[0]) throw new Error("定时任务不存在。");
    return toOutput(result.rows[0]);
  }

  async create(input: ScheduleInput): Promise<ScheduledTask> {
    validateSchedule(input);
    if (input.source.type === "archive")
      await this.security.requireProjectConfirmation(
        input.source.project_id ?? input.source.upload_id!,
        input.security,
        "创建定时任务",
      );
    if (input.source.type === "inline")
      this.security.requireInlineConfirmation(
        input.source.code ?? "",
        input.security,
        "创建定时任务",
      );
    const id = `schedule_${randomUUID()}`;
    const source = { ...input.source, security: input.security };
    const enabled = input.enabled !== false;
    const nextRunAt = enabled
      ? nextRun(
          input.schedule_type,
          input.cron_expression ?? null,
          input.run_at ?? null,
          input.timezone ?? "UTC",
        )
      : null;
    await this.db.query(
      `INSERT INTO pr_scheduled_tasks (id, name, description, source, args, timeout_seconds, schedule_type, cron_expression, run_at, timezone, enabled, status, next_run_at, notification_config)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)`,
      [
        id,
        input.name.trim().slice(0, 120),
        input.description?.trim().slice(0, 500) ?? "",
        JSON.stringify(source),
        JSON.stringify(input.args ?? []),
        Math.min(600, Math.max(1, Math.trunc(input.timeout_seconds ?? 30))),
        input.schedule_type,
        input.cron_expression ?? null,
        input.run_at ?? null,
        input.timezone ?? "UTC",
        enabled,
        enabled ? "enabled" : "disabled",
        nextRunAt,
        JSON.stringify(input.notification_config ?? {}),
      ],
    );
    return this.get(id);
  }

  async update(id: string, input: ScheduleInput): Promise<ScheduledTask> {
    await this.get(id);
    validateSchedule(input);
    if (input.source.type === "archive")
      await this.security.requireProjectConfirmation(
        input.source.project_id ?? input.source.upload_id!,
        input.security,
        "更新定时任务",
      );
    if (input.source.type === "inline")
      this.security.requireInlineConfirmation(
        input.source.code ?? "",
        input.security,
        "更新定时任务",
      );
    const enabled = input.enabled !== false;
    const nextRunAt = enabled
      ? nextRun(
          input.schedule_type,
          input.cron_expression ?? null,
          input.run_at ?? null,
          input.timezone ?? "UTC",
        )
      : null;
    await this.db.query(
      "UPDATE pr_scheduled_tasks SET name = $1, description = $2, source = $3::jsonb, args = $4::jsonb, timeout_seconds = $5, schedule_type = $6, cron_expression = $7, run_at = $8, timezone = $9, enabled = $10, status = $11, next_run_at = $12, notification_config = $13::jsonb, updated_at = NOW() WHERE id = $14",
      [
        input.name.trim().slice(0, 120),
        input.description?.trim().slice(0, 500) ?? "",
        JSON.stringify({ ...input.source, security: input.security }),
        JSON.stringify(input.args ?? []),
        Math.min(600, Math.max(1, Math.trunc(input.timeout_seconds ?? 30))),
        input.schedule_type,
        input.cron_expression ?? null,
        input.run_at ?? null,
        input.timezone ?? "UTC",
        enabled,
        enabled ? "enabled" : "disabled",
        nextRunAt,
        JSON.stringify(input.notification_config ?? {}),
        id,
      ],
    );
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    const result = await this.db.query(
      "DELETE FROM pr_scheduled_tasks WHERE id = $1",
      [id],
    );
    if (result.rowCount === 0) throw new Error("定时任务不存在。");
  }

  async enable(id: string): Promise<ScheduledTask> {
    const task = await this.get(id);
    const nextRunAt = nextRun(
      task.schedule_type as "cron" | "once",
      task.cron_expression,
      task.run_at,
      task.timezone,
    );
    await this.db.query(
      "UPDATE pr_scheduled_tasks SET enabled = TRUE, status = 'enabled', next_run_at = $1, updated_at = NOW() WHERE id = $2",
      [nextRunAt, id],
    );
    return this.get(id);
  }

  async disable(id: string): Promise<ScheduledTask> {
    await this.get(id);
    await this.db.query(
      "UPDATE pr_scheduled_tasks SET enabled = FALSE, status = 'disabled', next_run_at = NULL, updated_at = NOW() WHERE id = $1",
      [id],
    );
    return this.get(id);
  }

  async run(id: string): Promise<ScheduledTask> {
    const task = await this.get(id);
    await this.execute(task);
    return this.get(id);
  }

  async overview(): Promise<{ enabled: number; next: string | null }> {
    const result = await this.db.query<{
      enabled: string;
      next: string | null;
    }>(
      "SELECT COUNT(*) FILTER (WHERE enabled)::text AS enabled, MIN(next_run_at) AS next FROM pr_scheduled_tasks",
    );
    return {
      enabled: Number(result.rows[0]?.enabled ?? 0),
      next: result.rows[0]?.next
        ? new Date(result.rows[0].next).toISOString()
        : null,
    };
  }

  async upcoming(limit = 5): Promise<ScheduledTask[]> {
    const result = await this.db.query<ScheduleRow>(
      "SELECT * FROM pr_scheduled_tasks WHERE enabled = TRUE AND next_run_at IS NOT NULL ORDER BY next_run_at ASC LIMIT $1",
      [Math.min(20, Math.max(1, Math.trunc(limit)))],
    );
    return result.rows.map(toOutput);
  }

  async close(): Promise<void> {
    clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const result = await this.db.query<ScheduleRow>(
        "SELECT * FROM pr_scheduled_tasks WHERE enabled = TRUE AND next_run_at IS NOT NULL AND next_run_at <= NOW() ORDER BY next_run_at ASC LIMIT 20",
      );
      for (const row of result.rows) {
        const nextRunAt = nextRun(
          row.schedule_type as "cron" | "once",
          row.cron_expression,
          row.run_at,
          row.timezone,
        );
        await this.db.query(
          "UPDATE pr_scheduled_tasks SET next_run_at = $1, status = 'running', updated_at = NOW() WHERE id = $2 AND enabled = TRUE AND next_run_at <= NOW()",
          [nextRunAt, row.id],
        );
        void this.execute(toOutput(row)).catch(() => undefined);
      }
    } finally {
      this.ticking = false;
    }
  }

  private async execute(task: ScheduledTask): Promise<PythonExecution> {
    const started = new Date().toISOString();
    try {
      const execution = await this.executions.create({
        name: task.name,
        source: task.source,
        args: task.args,
        timeoutSeconds: task.timeout_seconds,
        runtimeEnvironment: "auto",
        security: (task.source as unknown as Record<string, unknown>).security,
        taskMode: "schedule",
        triggerType: "schedule",
        triggerId: task.id,
        notificationConfig: task.notification_config,
        notificationRecovered: task.last_status === "failed",
      });
      await this.db.query(
        "UPDATE pr_scheduled_tasks SET status = $1, last_execution_id = $2, last_run_at = $3, last_status = $4, total_runs = total_runs + 1, success_runs = success_runs + CASE WHEN $4 = 'success' THEN 1 ELSE 0 END, failed_runs = failed_runs + CASE WHEN $4 <> 'success' THEN 1 ELSE 0 END, updated_at = NOW() WHERE id = $5",
        ["enabled", execution.id, started, execution.status, task.id],
      );
      return execution;
    } catch (error) {
      await this.db.query(
        "UPDATE pr_scheduled_tasks SET status = 'enabled', last_run_at = $1, last_status = 'failed', total_runs = total_runs + 1, failed_runs = failed_runs + 1, updated_at = NOW() WHERE id = $2",
        [started, task.id],
      );
      throw error;
    }
  }
}

interface ScheduleRow {
  id: string;
  name: string;
  description: string;
  source: Record<string, unknown>;
  args: unknown;
  timeout_seconds: number;
  schedule_type: string;
  cron_expression: string | null;
  run_at: Date | string | null;
  timezone: string;
  enabled: boolean;
  status: string;
  next_run_at: Date | string | null;
  last_execution_id: string | null;
  last_run_at: Date | string | null;
  last_status: string | null;
  total_runs: number;
  success_runs: number;
  failed_runs: number;
  notification_config: Record<string, unknown> | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function toOutput(row: ScheduleRow): ScheduledTask {
  const source = row.source as unknown as ExecutionSource;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    code: source.type === "inline" ? (source.code ?? "") : "",
    source_type: source.type,
    source_config: { ...source } as Record<string, unknown>,
    source,
    args: Array.isArray(row.args) ? row.args.map(String) : [],
    timeout_seconds: row.timeout_seconds,
    schedule_type: row.schedule_type,
    cron_expression: row.cron_expression,
    run_at: row.run_at ? new Date(row.run_at).toISOString() : null,
    timezone: row.timezone,
    enabled: row.enabled,
    status: row.status,
    last_execution_id: row.last_execution_id,
    last_run_at: row.last_run_at
      ? new Date(row.last_run_at).toISOString()
      : null,
    next_run_at: row.next_run_at
      ? new Date(row.next_run_at).toISOString()
      : null,
    last_status: row.last_status,
    total_runs: row.total_runs,
    success_runs: row.success_runs,
    failed_runs: row.failed_runs,
    notification_config: row.notification_config ?? {},
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  };
}

function validateSchedule(input: ScheduleInput): void {
  if (!input.name?.trim()) throw new Error("定时任务名称不能为空。");
  if (
    !input.source ||
    (input.source.type === "inline" && !input.source.code?.trim()) ||
    (input.source.type === "archive" &&
      !(input.source.project_id ?? input.source.upload_id))
  )
    throw new Error("定时任务必须填写有效执行来源。");
  if (input.schedule_type === "cron" && !input.cron_expression?.trim())
    throw new Error("Cron 任务必须填写 Cron 表达式。");
  if (input.schedule_type === "once" && !input.run_at)
    throw new Error("一次性任务必须填写执行时间。");
  if (input.run_at && Number.isNaN(new Date(input.run_at).getTime()))
    throw new Error("一次性任务时间无效。");
  const timezone = input.timezone?.trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new Error("任务时区无效。");
  }
  if (input.schedule_type === "cron")
    parseCron(input.cron_expression!, timezone);
}

function nextRun(
  type: "cron" | "once",
  expression: string | null,
  runAt: string | Date | null,
  timezone: string,
): Date | null {
  if (type === "once") {
    const value = runAt ? new Date(runAt) : null;
    return value && value.getTime() > Date.now() ? value : null;
  }
  return CronExpressionParser.parse(expression ?? "", {
    currentDate: new Date(),
    tz: timezone,
  })
    .next()
    .toDate();
}

function parseCron(expression: string, timezone: string): void {
  if (expression.trim().split(/\s+/).length !== 5)
    throw new Error("Cron 表达式必须包含 5 个字段。");
  CronExpressionParser.parse(expression, {
    currentDate: new Date(),
    tz: timezone,
  }).next();
}
