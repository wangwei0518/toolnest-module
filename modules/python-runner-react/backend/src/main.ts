import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import yaml from "js-yaml";
import { createWriteStream } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { config } from "./config.js";
import { Database } from "./db.js";
import { EnvironmentService } from "./environment-service.js";
import { ExecutionManager } from "./execution-manager.js";
import { newId } from "./ids.js";
import { NotificationService } from "./notification-service.js";
import { PersistentManager } from "./persistent-manager.js";
import { ProjectImpactError, ProjectService } from "./project-service.js";
import { ScheduleManager } from "./schedule-manager.js";
import { SecurityError, SecurityService } from "./security-service.js";
import type { PythonExecution, PythonOverview } from "./types.js";

class ModuleHttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "ModuleHttpError";
  }
}

export interface ModuleAppContext {
  app: FastifyInstance;
  db: Database;
  executions: ExecutionManager;
  projects: ProjectService;
  environment: EnvironmentService;
  security: SecurityService;
  schedules: ScheduleManager;
  persistent: PersistentManager;
}

export async function createApp(): Promise<ModuleAppContext> {
  const db = new Database(config.databaseUrl, config.databaseSchema);
  await db.migrate();
  const projects = new ProjectService(db);
  const security = new SecurityService(db, projects);
  const notifications = new NotificationService();
  const executions = new ExecutionManager(
    db,
    projects,
    security,
    notifications,
  );
  const environment = new EnvironmentService(db, projects, security);
  const schedules = new ScheduleManager(db, executions, security);
  const persistent = new PersistentManager(
    db,
    projects,
    security,
    notifications,
  );
  const app = Fastify({ logger: false, bodyLimit: 8 * 1024 * 1024 });

  await mkdir(config.dataDir, { recursive: true });
  await mkdir(config.logDir, { recursive: true });
  await app.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024, files: 1 },
  });
  app.addHook("onRequest", async (request, reply) => {
    if (request.headers["x-toolnest-internal-token"] !== config.token)
      return reply.code(401).send({
        code: 401,
        message: "module authentication required",
        data: null,
      });
  });
  registerRoutes(app, {
    db,
    executions,
    projects,
    environment,
    security,
    schedules,
    persistent,
  });
  await persistent.initialize();
  app.addHook("onClose", async () => {
    await persistent.close();
    await schedules.close();
    await executions.close();
    await db.close();
  });
  return {
    app,
    db,
    executions,
    projects,
    environment,
    security,
    schedules,
    persistent,
  };
}

function registerRoutes(
  app: FastifyInstance,
  services: Omit<ModuleAppContext, "app" | "db"> & { db: Database },
): void {
  const {
    db,
    executions,
    projects,
    environment,
    security,
    schedules,
    persistent,
  } = services;
  app.get("/health/ready", async () => ({
    ready: true,
    module_id: config.moduleId,
    release_id: config.releaseId,
  }));

  app.get("/overview", async (): Promise<PythonOverview> => {
    const [stats, recent, scheduleStats, persistentStats] = await Promise.all([
      db.query<{
        running_count: number;
        today_total: number;
        today_success: number;
        today_failed: number;
        today_finished: number;
      }>(
        `SELECT COUNT(*) FILTER (WHERE status = 'running')::int AS running_count, COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::int AS today_total, COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE AND status = 'success')::int AS today_success, COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE AND status IN ('failed', 'timeout'))::int AS today_failed, COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE AND status IN ('success', 'failed', 'timeout', 'stopped', 'skipped'))::int AS today_finished FROM pr_executions`,
      ),
      executions.list(),
      schedules.overview(),
      persistent.overview(),
    ]);
    const current = stats.rows[0] ?? {
      running_count: 0,
      today_total: 0,
      today_success: 0,
      today_failed: 0,
      today_finished: 0,
    };
    const runningExecutions = recent
      .filter((item) => item.status === "running")
      .slice(0, 5);
    const upcomingSchedules = await schedules.upcoming(5);
    return {
      stats: {
        running_count: current.running_count,
        today_total: current.today_total,
        today_success: current.today_success,
        today_failed: current.today_failed,
        success_rate: current.today_finished
          ? Math.round(
              (current.today_success / current.today_finished) * 1000,
            ) / 10
          : 0,
        enabled_schedule_count: scheduleStats.enabled,
        next_schedule_time: scheduleStats.next,
        running_persistent_count: persistentStats.running,
        failed_persistent_count: persistentStats.failed,
      },
      recent_executions: recent.slice(0, 10),
      running_executions: runningExecutions,
      upcoming_schedules: upcomingSchedules.map((task) => ({
        id: task.id,
        name: task.name,
        description: task.description,
        schedule_type: task.schedule_type,
        cron_expression: task.cron_expression,
        next_run_at: task.next_run_at,
        status: task.status,
      })),
      recent_logs: overviewLogs(recent, false, 20),
      error_logs: overviewLogs(recent, true, 20),
    };
  });
  app.post("/security/scan-inline", async (request) => {
    const body = request.body as { code?: unknown };
    if (typeof body?.code !== "string" || !body.code.trim())
      throw new Error("Python 代码不能为空。");
    return security.scanInline(body.code);
  });
  app.get("/timeline", async (request) => {
    const limit = Math.min(
      50,
      Math.max(1, Number((request.query as { limit?: string }).limit ?? 30)),
    );
    const [items, upcoming] = await Promise.all([
      executions.list(),
      schedules.upcoming(5),
    ]);
    const timeline = [
      ...upcoming.map((task) => ({
        id: `schedule_${task.id}`,
        kind: "schedule_upcoming",
        status: "upcoming",
        title: task.name,
        subtitle: task.description || "计划任务",
        event_time: task.next_run_at ?? task.updated_at,
        trigger_type: "schedule",
        schedule_text:
          task.schedule_type === "cron" ? task.cron_expression : "一次性任务",
        schedule_id: task.id,
      })),
      ...items
        .filter((item) => item.status === "running")
        .slice(0, 5)
        .map(executionTimelineEvent),
      ...items
        .filter((item) => item.status !== "running")
        .slice(0, 10)
        .map(executionTimelineEvent),
    ];
    return { items: timeline.slice(0, limit) };
  });

  app.get("/projects", async () => projects.listSummaries());
  app.get("/uploads", async (request) =>
    projects.list((request.query as { status?: string }).status),
  );
  app.post("/uploads/archive", async (request) => {
    const upload = await readMultipartArchive(request);
    return projects.createFromArchive(upload);
  });
  app.get<{ Params: { id: string } }>("/uploads/:id", async (request) =>
    projects.getUpload(request.params.id),
  );
  app.delete<{ Params: { id: string } }>("/uploads/:id", async (request) => {
    await projects.delete(request.params.id);
    return null;
  });
  app.post<{ Params: { id: string } }>(
    "/uploads/:id/update",
    async (request) => {
      const upload = await readMultipartArchive(request);
      return projects.updateFromArchive(request.params.id, upload);
    },
  );
  app.post<{ Params: { id: string } }>(
    "/uploads/:id/rollback",
    async (request) =>
      projects.rollback(
        request.params.id,
        Boolean(
          (request.body as { confirm_schedule_impact?: unknown } | undefined)
            ?.confirm_schedule_impact,
        ),
      ),
  );
  app.get<{
    Params: { id: string };
    Querystring: { path?: string; scope?: string };
  }>("/uploads/:id/files/preview", async (request) =>
    previewProjectFile(
      projects,
      request.params.id,
      request.query.path,
      request.query.scope,
    ),
  );
  app.get<{ Params: { id: string } }>("/uploads/:id/storage", async (request) =>
    getProjectStorage(db, projects, request.params.id),
  );
  app.get<{ Params: { id: string } }>(
    "/uploads/:id/security",
    async (request) => security.getProjectSecurity(request.params.id),
  );
  app.get<{ Params: { id: string } }>(
    "/uploads/:id/security/findings",
    async (request) => security.findings(request.params.id),
  );
  app.post<{ Params: { id: string } }>(
    "/uploads/:id/security/scan",
    async (request) => security.scanProject(request.params.id),
  );
  app.get<{ Params: { id: string } }>(
    "/uploads/:id/environment",
    async (request) => environment.get(request.params.id),
  );
  app.post<{ Params: { id: string } }>(
    "/uploads/:id/environment/create",
    async (request) => environment.create(request.params.id),
  );
  app.post<{ Params: { id: string } }>(
    "/uploads/:id/environment/install-requirements",
    async (request) =>
      environment.installRequirements(
        request.params.id,
        request.body as Record<string, unknown>,
      ),
  );
  app.post<{ Params: { id: string } }>(
    "/uploads/:id/environment/rebuild",
    async (request) => environment.rebuild(request.params.id),
  );
  app.delete<{ Params: { id: string } }>(
    "/uploads/:id/environment",
    async (request) => environment.delete(request.params.id),
  );
  app.get<{ Params: { id: string } }>(
    "/uploads/:id/environment/install-log",
    async (request) => environment.installLog(request.params.id),
  );
  app.delete<{ Params: { id: string } }>("/uploads/:id/data", async (request) =>
    environment.clearData(request.params.id),
  );
  app.get<{ Params: { id: string } }>("/uploads/:id/config", async (request) =>
    getProjectConfig(projects, request.params.id),
  );
  app.put<{ Params: { id: string } }>("/uploads/:id/config", async (request) =>
    saveProjectConfig(
      projects,
      request.params.id,
      request.body as Record<string, unknown>,
    ),
  );
  app.post<{ Params: { id: string } }>(
    "/uploads/:id/maintenance/cleanup",
    async (request) =>
      cleanupProject(
        db,
        projects,
        environment,
        request.params.id,
        request.body as { target?: string },
      ),
  );

  app.post("/executions", async (request) => {
    const body = request.body as Record<string, unknown>;
    const source = (body.source ?? {}) as Record<string, unknown>;
    return executions.create({
      name: typeof body.name === "string" ? body.name : "未命名脚本",
      source: source as never,
      args: Array.isArray(body.args) ? body.args.map(String) : [],
      timeoutSeconds:
        typeof body.timeout_seconds === "number" ? body.timeout_seconds : 30,
      runtimeEnvironment:
        body.runtime_environment === "project_venv" ||
        body.runtime_environment === "system"
          ? body.runtime_environment
          : "auto",
      security: body.security,
      workingDirectory:
        typeof body.working_directory === "string"
          ? body.working_directory
          : null,
    });
  });
  app.get("/executions", async () => executions.list());
  app.get<{ Params: { id: string } }>("/executions/:id", async (request) =>
    executions.get(request.params.id),
  );
  app.get<{
    Params: { id: string };
    Querystring: { limit?: string; after?: string };
  }>("/executions/:id/logs", async (request) =>
    executions.logs(
      request.params.id,
      Math.min(500, Math.max(1, Number(request.query.limit ?? 200))),
      request.query.after,
    ),
  );
  app.get<{ Params: { id: string } }>(
    "/executions/:id/logs/stream",
    async (request, reply) => {
      const events = await executions.logs(request.params.id);
      reply
        .type("text/event-stream; charset=utf-8")
        .header("cache-control", "no-cache")
        .send(
          events
            .map(
              (event) =>
                `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
            )
            .join(""),
        );
    },
  );
  app.post<{ Params: { id: string } }>(
    "/executions/:id/stop",
    async (request) => executions.stop(request.params.id),
  );
  app.post<{ Params: { id: string } }>(
    "/executions/:id/rerun",
    async (request) => executions.rerun(request.params.id),
  );
  app.delete<{ Params: { id: string } }>("/executions/:id", async (request) => {
    await executions.remove(request.params.id);
    return null;
  });

  app.get("/scheduled-tasks", async (request) =>
    schedules.list(
      request.query as {
        keyword?: string;
        status?: string;
        page?: number;
        page_size?: number;
      },
    ),
  );
  app.post("/scheduled-tasks", async (request) =>
    schedules.create(request.body as never),
  );
  app.get<{ Params: { id: string } }>("/scheduled-tasks/:id", async (request) =>
    schedules.get(request.params.id),
  );
  app.put<{ Params: { id: string } }>("/scheduled-tasks/:id", async (request) =>
    schedules.update(request.params.id, request.body as never),
  );
  app.delete<{ Params: { id: string } }>(
    "/scheduled-tasks/:id",
    async (request) => {
      await schedules.remove(request.params.id);
      return null;
    },
  );
  app.post<{ Params: { id: string } }>(
    "/scheduled-tasks/:id/enable",
    async (request) => schedules.enable(request.params.id),
  );
  app.post<{ Params: { id: string } }>(
    "/scheduled-tasks/:id/disable",
    async (request) => schedules.disable(request.params.id),
  );
  app.post<{ Params: { id: string } }>(
    "/scheduled-tasks/:id/run",
    async (request) => schedules.run(request.params.id),
  );

  app.get("/persistent-tasks", async (request) =>
    persistent.list(
      request.query as {
        keyword?: string;
        status?: string;
        page?: number;
        page_size?: number;
      },
    ),
  );
  app.post("/persistent-tasks", async (request) =>
    persistent.create(request.body as never),
  );
  app.get<{ Params: { id: string } }>(
    "/persistent-tasks/:id",
    async (request) => persistent.get(request.params.id),
  );
  app.put<{ Params: { id: string } }>(
    "/persistent-tasks/:id",
    async (request) =>
      persistent.update(request.params.id, request.body as never),
  );
  app.delete<{ Params: { id: string } }>(
    "/persistent-tasks/:id",
    async (request) => {
      await persistent.remove(request.params.id);
      return null;
    },
  );
  app.post<{ Params: { id: string } }>(
    "/persistent-tasks/:id/start",
    async (request) => persistent.start(request.params.id),
  );
  app.post<{ Params: { id: string } }>(
    "/persistent-tasks/:id/stop",
    async (request) => persistent.stop(request.params.id),
  );
  app.post<{ Params: { id: string } }>(
    "/persistent-tasks/:id/restart",
    async (request) => persistent.restart(request.params.id),
  );
  app.get<{ Params: { id: string }; Querystring: { lines?: string } }>(
    "/persistent-tasks/:id/logs",
    async (request) =>
      persistent.logs(request.params.id, Number(request.query.lines ?? 300)),
  );
  app.post<{ Params: { id: string } }>(
    "/persistent-tasks/:id/logs/clear",
    async (request) => persistent.clearLogs(request.params.id),
  );
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    "/persistent-tasks/:id/events",
    async (request) =>
      persistent.events(request.params.id, Number(request.query.limit ?? 50)),
  );

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof SecurityError)
      return reply.code(error.statusCode).send({
        code: error.statusCode,
        message: error.message,
        data: { security: error.security },
      });
    if (error instanceof ProjectImpactError)
      return reply.code(error.statusCode).send({
        code: error.statusCode,
        message: error.message,
        data: { impact: error.impact },
      });
    const status =
      typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? Number((error as { statusCode: number }).statusCode)
        : error instanceof Error && error.message.includes("不存在")
          ? 404
          : 400;
    return reply.code(status).send({
      code: status,
      message: error instanceof Error ? error.message : "module request failed",
      data: null,
    });
  });
}

function overviewLogs(
  items: PythonExecution[],
  onlyErrors: boolean,
  limit: number,
) {
  const logs: Array<{
    execution_id: string;
    execution_name: string;
    type: string;
    content: string;
    timestamp: string;
    status: string;
    exit_code: number | null;
  }> = [];
  for (const item of items) {
    const outputs = onlyErrors
      ? [{ type: "stderr", content: item.stderr }]
      : [
          { type: "stdout", content: item.stdout },
          { type: "stderr", content: item.stderr },
        ];
    for (const output of outputs) {
      for (const content of output.content
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-3)) {
        logs.push({
          execution_id: item.id,
          execution_name: item.name,
          type: output.type,
          content: content.slice(0, 240),
          timestamp: item.updated_at,
          status: item.status,
          exit_code: item.exit_code,
        });
      }
    }
    if (
      onlyErrors &&
      !item.stderr &&
      ["failed", "timeout"].includes(item.status)
    ) {
      logs.push({
        execution_id: item.id,
        execution_name: item.name,
        type: "stderr",
        content: item.status === "timeout" ? "执行超时。" : "执行失败。",
        timestamp: item.updated_at,
        status: item.status,
        exit_code: item.exit_code,
      });
    }
  }
  return logs.slice(0, limit);
}

function executionTimelineEvent(item: PythonExecution) {
  const scheduleId = item.task_mode === "scheduled" ? item.trigger_id : null;
  const kind =
    {
      success: "execution_success",
      failed: "execution_failed",
      timeout: "execution_failed",
      stopped: "execution_stopped",
      running: "execution_running",
      skipped: "execution_skipped",
    }[item.status] ?? "execution_stopped";
  const status =
    {
      success: "finished",
      failed: "failed",
      timeout: "failed",
      stopped: "stopped",
      running: "running",
      skipped: "skipped",
    }[item.status] ?? "stopped";
  return {
    id: `execution_${item.id}`,
    kind,
    status,
    title: item.name,
    subtitle: item.trigger_type,
    event_time: item.started_at ?? item.created_at,
    trigger_type: item.trigger_type,
    execution_id: item.id,
    duration_ms: item.duration_ms,
    exit_code: item.exit_code,
    schedule_id: scheduleId,
    error_summary: executionErrorSummary(item),
  };
}

function executionErrorSummary(item: PythonExecution): string | null {
  const firstError = item.stderr.split(/\r?\n/).find((line) => line.trim());
  if (firstError) return firstError.trim().slice(0, 240);
  if (item.status === "timeout")
    return item.exit_code === null ? "执行超时。" : `退出码 ${item.exit_code}`;
  if (item.status === "failed")
    return item.exit_code === null ? "执行失败。" : `退出码 ${item.exit_code}`;
  return null;
}

async function readMultipartArchive(request: FastifyRequest): Promise<{
  archivePath: string;
  name?: string;
  filename: string;
  uploadSource?: string;
  confirmScheduleImpact?: boolean;
}> {
  const incomingDir = path.join(config.dataDir, "incoming");
  await mkdir(incomingDir, { recursive: true });
  const archivePath = path.join(incomingDir, `${newId("archive")}.zip`);
  let filename = "project.zip";
  const fields: Record<string, string> = {};
  let foundFile = false;
  try {
    for await (const part of request.parts()) {
      if (part.type === "file") {
        if (part.fieldname !== "file") {
          part.file.resume();
          continue;
        }
        foundFile = true;
        filename = part.filename || filename;
        await pipeline(part.file, createWriteStream(archivePath));
        if (part.file.truncated) throw new Error("ZIP 文件超过 50 MiB 限制。");
      } else fields[part.fieldname] = String(part.value);
    }
    if (!foundFile) throw new Error("必须上传 ZIP 文件。");
    return {
      archivePath,
      name: fields.name,
      filename,
      uploadSource: fields.upload_source,
      confirmScheduleImpact: fields.confirm_schedule_impact === "true",
    };
  } catch (error) {
    await rm(archivePath, { force: true }).catch(() => undefined);
    throw error;
  }
}

const CONFIG_FILENAMES = ["config.json", "config.yaml", "config.yml"] as const;
const MAX_CONFIG_BYTES = 1024 * 1024;
const SENSITIVE_KEY_MARKERS = [
  "password",
  "passwd",
  "secret",
  "token",
  "api_key",
  "apikey",
  "private_key",
  "session",
  "credential",
];
const SENSITIVE_MASK = "********";

async function getProjectConfig(
  projects: ProjectService,
  projectId: string,
): Promise<Record<string, unknown>> {
  const project = await projects.get(projectId);
  const fileName = await findConfigFile(
    projects,
    projectId,
    project.sourceRoot,
  );
  const sourcePath = path.join(project.sourceRoot, fileName);
  const overridePath = path.join(
    projects.projectRoot(projectId),
    overrideFileName(fileName),
  );
  const source = await readConfigFile(sourcePath, fileName);
  const override = await readConfigFile(overridePath, fileName);
  const effective = override.exists ? override : source;
  const sensitivePaths: string[] = [];
  const configuredSensitivePaths: string[] = [];
  const values = effective.value
    ? maskSensitive(effective.value, sensitivePaths, configuredSensitivePaths)
    : {};
  const content =
    effective.exists && effective.valid
      ? serializeConfig(values as Record<string, unknown>, fileName)
      : "";
  return {
    upload_id: projectId,
    file_name: fileName,
    detected: source.exists || override.exists,
    source_exists: source.exists,
    override_exists: override.exists,
    valid: effective.valid,
    error: effective.error,
    values,
    sensitive_paths: sensitivePaths,
    configured_sensitive_paths: configuredSensitivePaths,
    source_updated_at: source.updatedAt,
    updated_at: override.updatedAt ?? source.updatedAt,
    size: Buffer.byteLength(content),
    content,
  };
}

const PREVIEW_MAX_BYTES = 1024 * 1024;
const PREVIEW_SUFFIXES: Record<string, string> = {
  ".py": "python",
  ".txt": "text",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".md": "markdown",
  ".ini": "ini",
  ".cfg": "ini",
  ".conf": "ini",
  ".log": "log",
};
const PREVIEW_FILENAMES: Record<string, string> = {
  "requirements.txt": "pip-requirements",
  dockerfile: "dockerfile",
  makefile: "makefile",
  ".env.example": "env",
};
const PREVIEW_SENSITIVE_NAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  "credentials.json",
  "token.json",
  "secret.json",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
]);
const PREVIEW_SENSITIVE_SUFFIXES = new Set([
  ".pem",
  ".key",
  ".crt",
  ".p12",
  ".pfx",
]);

async function previewProjectFile(
  projects: ProjectService,
  projectId: string,
  rawPath: string | undefined,
  scope: string | undefined,
): Promise<Record<string, unknown>> {
  if (scope && scope !== "source")
    throw new ModuleHttpError(422, "当前仅支持预览项目 source 文件。");
  if (!rawPath || rawPath.trim() !== rawPath)
    throw new ModuleHttpError(422, "文件路径非法。");
  await projects.get(projectId);
  const filePath = await projects.resolveSourcePath(projectId, rawPath);
  const fileStat = await stat(filePath).catch(() => null);
  if (!fileStat?.isFile()) throw new ModuleHttpError(404, "文件不存在。");
  const name = path.basename(rawPath).toLowerCase();
  const extension = path.extname(name);
  if (
    PREVIEW_SENSITIVE_NAMES.has(name) ||
    PREVIEW_SENSITIVE_SUFFIXES.has(extension)
  )
    throw new ModuleHttpError(403, "敏感文件不允许预览。");
  if (!(extension in PREVIEW_SUFFIXES) && !(name in PREVIEW_FILENAMES))
    throw new ModuleHttpError(415, "该文件类型暂不支持预览。");
  if (fileStat.size > PREVIEW_MAX_BYTES)
    throw new ModuleHttpError(
      413,
      "文件过大，当前仅支持预览 1 MB 以内的文本文件。",
    );
  const raw = await readFile(filePath);
  if (raw.subarray(0, 4096).includes(0))
    throw new ModuleHttpError(415, "暂不支持预览二进制文件。");
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    throw new ModuleHttpError(415, "暂不支持该文件编码。");
  }
  return {
    path: rawPath,
    filename: path.basename(rawPath),
    language: PREVIEW_FILENAMES[name] ?? PREVIEW_SUFFIXES[extension] ?? "text",
    size: fileStat.size,
    encoding: "utf-8",
    truncated: false,
    readonly: true,
    content,
  };
}

async function saveProjectConfig(
  projects: ProjectService,
  projectId: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const project = await projects.get(projectId);
  const fileName = await findConfigFile(
    projects,
    projectId,
    project.sourceRoot,
  );
  const sourcePath = path.join(project.sourceRoot, fileName);
  const overridePath = path.join(
    projects.projectRoot(projectId),
    overrideFileName(fileName),
  );
  const current = await readConfigFile(overridePath, fileName);
  const source = await readConfigFile(sourcePath, fileName);
  const currentValue = current.value ?? source.value ?? {};
  const submitted =
    typeof body.content === "string"
      ? parseConfig(body.content, fileName)
      : parseValue(body.values);
  if (!submitted.value)
    throw new Error(submitted.error ?? `配置不是有效的 ${fileName} 数据。`);
  restoreSensitive(
    currentValue,
    submitted.value,
    collectSensitivePaths(currentValue),
  );
  const content = serializeConfig(submitted.value, fileName);
  if (Buffer.byteLength(content) > MAX_CONFIG_BYTES)
    throw new Error(`${fileName} 不能超过 1 MB。`);
  await mkdir(path.dirname(overridePath), { recursive: true });
  const temporary = `${overridePath}.${newId("config-tmp")}.tmp`;
  await writeFile(temporary, content, "utf8");
  const { rename } = await import("node:fs/promises");
  await rename(temporary, overridePath);
  return getProjectConfig(projects, projectId);
}

interface ConfigReadResult {
  exists: boolean;
  valid: boolean;
  value: Record<string, unknown> | null;
  error: string | null;
  updatedAt: string | null;
}

async function findConfigFile(
  projects: ProjectService,
  projectId: string,
  sourceRoot: string,
): Promise<string> {
  for (const fileName of CONFIG_FILENAMES) {
    if (
      await fileExists(
        path.join(projects.projectRoot(projectId), overrideFileName(fileName)),
      )
    )
      return fileName;
  }
  for (const fileName of CONFIG_FILENAMES) {
    if (await fileExists(path.join(sourceRoot, fileName))) return fileName;
  }
  return CONFIG_FILENAMES[0];
}

async function readConfigFile(
  filePath: string,
  fileName: string,
): Promise<ConfigReadResult> {
  const metadata = await stat(filePath).catch(() => null);
  if (!metadata?.isFile())
    return {
      exists: false,
      valid: true,
      value: null,
      error: null,
      updatedAt: null,
    };
  if (metadata.size > MAX_CONFIG_BYTES)
    return {
      exists: true,
      valid: false,
      value: null,
      error: `${fileName} 不能超过 1 MB。`,
      updatedAt: metadata.mtime.toISOString(),
    };
  try {
    const content = await readFile(filePath, "utf8");
    const parsed = parseConfig(content, fileName);
    return {
      exists: true,
      valid: parsed.value !== null,
      value: parsed.value,
      error: parsed.error,
      updatedAt: metadata.mtime.toISOString(),
    };
  } catch {
    return {
      exists: true,
      valid: false,
      value: null,
      error: `无法读取 ${fileName}。`,
      updatedAt: metadata.mtime.toISOString(),
    };
  }
}

function parseConfig(
  content: string,
  fileName: string,
): { value: Record<string, unknown> | null; error: string | null } {
  try {
    const parsed = fileName.endsWith(".json")
      ? (JSON.parse(content) as unknown)
      : yaml.load(content);
    return parseValue(parsed);
  } catch {
    return { value: null, error: `${fileName} 格式无效。` };
  }
}

function parseValue(value: unknown): {
  value: Record<string, unknown> | null;
  error: string | null;
} {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { value: null, error: "配置根节点必须是对象。" };
  return { value: value as Record<string, unknown>, error: null };
}

function serializeConfig(
  value: Record<string, unknown>,
  fileName: string,
): string {
  return fileName.endsWith(".json")
    ? `${JSON.stringify(value, null, 2)}\n`
    : yaml.dump(value, { noRefs: true, sortKeys: false, lineWidth: 120 });
}

function maskSensitive(
  value: unknown,
  paths: string[],
  configured: string[],
  prefix = "",
): Record<string, unknown> | unknown {
  if (Array.isArray(value))
    return value.map((item, index) =>
      maskSensitive(item, paths, configured, `${prefix}[${index}]`),
    );
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const itemPath = prefix ? `${prefix}.${key}` : key;
    if (isSensitiveKey(key)) {
      paths.push(itemPath);
      if (!isBlankSensitive(item)) configured.push(itemPath);
      output[key] = blankSensitive(item);
    } else {
      output[key] = maskSensitive(item, paths, configured, itemPath);
    }
  }
  return output;
}

function collectSensitivePaths(value: unknown, prefix = ""): string[] {
  const paths: string[] = [];
  if (Array.isArray(value))
    value.forEach((item, index) =>
      paths.push(...collectSensitivePaths(item, `${prefix}[${index}]`)),
    );
  else if (value && typeof value === "object")
    for (const [key, item] of Object.entries(value)) {
      const itemPath = prefix ? `${prefix}.${key}` : key;
      if (isSensitiveKey(key)) paths.push(itemPath);
      else paths.push(...collectSensitivePaths(item, itemPath));
    }
  return paths;
}

function restoreSensitive(
  current: unknown,
  submitted: Record<string, unknown>,
  paths: string[],
): void {
  for (const itemPath of paths) {
    const oldValue = getPath(current, itemPath);
    const newValue = getPath(submitted, itemPath);
    if (!isBlankSensitive(oldValue) && isBlankSensitive(newValue))
      setPath(submitted, itemPath, oldValue);
  }
}

function getPath(value: unknown, itemPath: string): unknown {
  let current = value;
  for (const part of itemPath
    .replaceAll("]", "")
    .replaceAll("[", ".")
    .split(".")
    .filter(Boolean)) {
    if (current && typeof current === "object" && !Array.isArray(current))
      current = (current as Record<string, unknown>)[part];
    else if (Array.isArray(current) && /^\d+$/.test(part))
      current = current[Number(part)];
    else return undefined;
  }
  return current;
}
function setPath(
  value: Record<string, unknown>,
  itemPath: string,
  next: unknown,
): void {
  const parts = itemPath
    .replaceAll("]", "")
    .replaceAll("[", ".")
    .split(".")
    .filter(Boolean);
  let current: unknown = value;
  for (const part of parts.slice(0, -1)) {
    if (current && typeof current === "object" && !Array.isArray(current))
      current = (current as Record<string, unknown>)[part];
    else if (Array.isArray(current) && /^\d+$/.test(part))
      current = current[Number(part)];
    else return;
  }
  const last = parts.at(-1);
  if (!last || !current || typeof current !== "object") return;
  if (Array.isArray(current) && /^\d+$/.test(last))
    current[Number(last)] = next;
  else if (!Array.isArray(current))
    (current as Record<string, unknown>)[last] = next;
}
function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replaceAll("-", "_");
  return SENSITIVE_KEY_MARKERS.some((marker) => normalized.includes(marker));
}
function isBlankSensitive(value: unknown): boolean {
  return Boolean(
    value === null ||
    value === "" ||
    value === SENSITIVE_MASK ||
    (Array.isArray(value) && value.length === 0) ||
    (value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0),
  );
}
function blankSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return [];
  if (value && typeof value === "object") return {};
  return SENSITIVE_MASK;
}
async function fileExists(filePath: string): Promise<boolean> {
  return stat(filePath)
    .then((value) => value.isFile())
    .catch(() => false);
}
function overrideFileName(fileName: string): string {
  return `config.override${path.extname(fileName)}`;
}
async function getProjectStorage(
  db: Database,
  projects: ProjectService,
  projectId: string,
): Promise<Record<string, unknown>> {
  const project = await projects.get(projectId);
  const root = projects.projectRoot(projectId);
  const workspacePaths = await projectWorkspacePaths(db, projectId);
  const logPaths = await projectLogPaths(db, projectId);
  const [source, venv, data, workspace, logs, backups] = await Promise.all([
    directoryStats(project.sourceRoot),
    directoryStats(path.join(root, "venv")),
    directoryStats(path.join(root, "data")),
    statsForPaths(workspacePaths),
    statsForPaths(logPaths),
    directoryStats(path.join(root, "backups")),
  ]);
  const backupEntries = await readdir(path.join(root, "backups"), {
    withFileTypes: true,
  }).catch(() => []);
  const backupDirs = backupEntries.filter((entry) => entry.isDirectory());
  let latestBackupAt: string | null = null;
  for (const entry of backupDirs) {
    const value = await stat(path.join(root, "backups", entry.name)).catch(
      () => null,
    );
    if (value && (!latestBackupAt || value.mtime > new Date(latestBackupAt)))
      latestBackupAt = value.mtime.toISOString();
  }
  const totalSize =
    source.bytes +
    venv.bytes +
    data.bytes +
    workspace.bytes +
    logs.bytes +
    backups.bytes;
  return {
    source_size: source.bytes,
    venv_size: venv.bytes,
    data_size: data.bytes,
    workspace_size: workspace.bytes,
    logs_size: logs.bytes,
    backup_size: backups.bytes,
    backup_count: backupDirs.length,
    latest_backup_at: latestBackupAt,
    total_size: totalSize,
    workspace_count: workspacePaths.length,
    last_updated_at:
      project.row.updated_at instanceof Date
        ? project.row.updated_at.toISOString()
        : new Date(project.row.updated_at).toISOString(),
  };
}

async function cleanupProject(
  db: Database,
  projects: ProjectService,
  environment: EnvironmentService,
  projectId: string,
  body: { target?: string },
): Promise<Record<string, unknown>> {
  await projects.get(projectId);
  const target = body.target ?? "";
  const root = projects.projectRoot(projectId);
  let paths: string[];
  if (target === "project_data") paths = [path.join(root, "data")];
  else if (target === "venv") paths = [path.join(root, "venv")];
  else if (target === "backups") paths = [path.join(root, "backups")];
  else if (target === "install_logs")
    paths = [path.join(config.logDir, "projects", `${projectId}.install.log`)];
  else if (target === "workspaces" || target === "execution_snapshots")
    paths = await projectWorkspacePaths(db, projectId);
  else throw new ModuleHttpError(422, "不支持的清理目标。");

  const before = await statsForPaths(paths);
  if (target === "venv") await environment.delete(projectId);
  else
    for (const targetPath of paths)
      await rm(targetPath, { recursive: true, force: true });
  return {
    target,
    deleted_files: before.files,
    freed_bytes: before.bytes,
    message: cleanupMessage(target),
  };
}

async function projectWorkspacePaths(
  db: Database,
  projectId: string,
): Promise<string[]> {
  const executionRows = await db.query<{ workspace_path: string | null }>(
    "SELECT workspace_path FROM pr_executions WHERE project_id = $1 AND status <> 'running' AND workspace_path IS NOT NULL",
    [projectId],
  );
  const persistentRows = await db.query<{ id: string; status: string }>(
    "SELECT id, status FROM pr_persistent_tasks WHERE (source->>'project_id' = $1 OR source->>'upload_id' = $1) AND status <> 'running'",
    [projectId],
  );
  return [
    ...new Set([
      ...executionRows.rows
        .map((row) => row.workspace_path)
        .filter((value): value is string => Boolean(value)),
      ...persistentRows.rows.map((row) =>
        path.join(config.dataDir, "persistent", row.id),
      ),
    ]),
  ];
}

async function projectLogPaths(
  db: Database,
  projectId: string,
): Promise<string[]> {
  const executionRows = await db.query<{
    stdout_path: string | null;
    stderr_path: string | null;
  }>(
    "SELECT stdout_path, stderr_path FROM pr_executions WHERE project_id = $1",
    [projectId],
  );
  const persistentRows = await db.query<{ id: string }>(
    "SELECT id FROM pr_persistent_tasks WHERE source->>'project_id' = $1 OR source->>'upload_id' = $1",
    [projectId],
  );
  return [
    ...new Set([
      path.join(config.logDir, "projects", `${projectId}.install.log`),
      ...executionRows.rows
        .flatMap((row) => [row.stdout_path, row.stderr_path])
        .filter((value): value is string => Boolean(value)),
      ...persistentRows.rows.map((row) =>
        path.join(config.logDir, "persistent", `${row.id}.log`),
      ),
    ]),
  ];
}

function cleanupMessage(target: string): string {
  return (
    (
      {
        workspaces: "已清理执行工作区",
        execution_snapshots: "已清理执行快照",
        install_logs: "已清理安装日志",
        project_data: "已清空项目数据",
        venv: "已删除虚拟环境",
        backups: "已清理项目备份",
      } as Record<string, string>
    )[target] ?? "清理完成。"
  );
}
type PathStats = { files: number; bytes: number };
async function statsForPaths(paths: string[]): Promise<PathStats> {
  const values = await Promise.all(
    paths.map((target) => directoryStats(target)),
  );
  return values.reduce(
    (total, value) => ({
      files: total.files + value.files,
      bytes: total.bytes + value.bytes,
    }),
    { files: 0, bytes: 0 },
  );
}
async function directoryStats(root: string): Promise<PathStats> {
  const value = await stat(root).catch(() => null);
  if (!value) return { files: 0, bytes: 0 };
  if (value.isFile()) return { files: 1, bytes: value.size };
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const children = await Promise.all(
    entries.map((entry) => directoryStats(path.join(root, entry.name))),
  );
  return children.reduce(
    (total, child) => ({
      files: total.files + child.files,
      bytes: total.bytes + child.bytes,
    }),
    { files: 0, bytes: 0 },
  );
}

if (process.env.NODE_ENV !== "test" && process.env.VITEST !== "true") {
  const context = await createApp();
  await context.app.listen({ host: "127.0.0.1", port: config.port });
  const shutdown = async () => {
    await context.app.close().catch(() => undefined);
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
}
