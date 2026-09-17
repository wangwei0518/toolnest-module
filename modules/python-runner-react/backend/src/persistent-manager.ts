import { appendFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { config } from './config.js'
import { Database } from './db.js'
import { newId } from './ids.js'
import { normalizeNotificationConfig, NotificationService, type NotificationConfig } from './notification-service.js'
import { ProjectService } from './project-service.js'
import { SecurityService } from './security-service.js'
import type { ExecutionSource } from './execution-manager.js'

export interface PersistentInput {
  name: string
  description?: string
  source: ExecutionSource
  args?: string[]
  runtime_environment?: 'auto' | 'project_venv' | 'system'
  working_directory?: string | null
  auto_start?: boolean
  restart_policy?: 'never' | 'on_failure' | 'always'
  restart_delay_seconds?: number
  max_restart_count?: number
  notification_config?: unknown
  security?: unknown
}

export interface PersistentTask {
  id: string; name: string; description: string; code: string; source_type: string; source_config: Record<string, unknown>; source: ExecutionSource; args: string[]; runtime_environment: string; working_directory: string | null; status: string; auto_start: boolean; restart_policy: string; restart_delay_seconds: number; max_restart_count: number; notification_config: NotificationConfig; current_execution_id: string | null; pid: number | null; started_at: string | null; stopped_at: string | null; last_heartbeat_at: string | null; restart_count: number; last_exit_code: number | null; last_error: string | null; created_at: string; updated_at: string
}

interface ActiveProcess { child: ChildProcess; taskId: string; workspace: string; logPath: string; stopping: boolean }

export class PersistentManager {
  private readonly active = new Map<string, ActiveProcess>()
  private readonly restartTimers = new Map<string, NodeJS.Timeout>()

  constructor(private readonly db: Database, private readonly projects: ProjectService, private readonly security: SecurityService, private readonly notifications: NotificationService) {}

  async initialize(): Promise<void> {
    const result = await this.db.query<TaskRow>('SELECT * FROM pr_persistent_tasks WHERE auto_start = TRUE')
    for (const row of result.rows) void this.start(row.id).catch(() => undefined)
  }

  async list(query: { keyword?: string; status?: string; page?: number; page_size?: number } = {}): Promise<{ items: PersistentTask[]; total: number; page: number; page_size: number }> {
    const page = Math.max(1, query.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, query.page_size ?? 20))
    const keyword = query.keyword?.trim() || null
    const status = query.status?.trim() || null
    const count = await this.db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM pr_persistent_tasks WHERE ($1::text IS NULL OR name ILIKE \'%\' || $1 || \'%\') AND ($2::text IS NULL OR status = $2)', [keyword, status])
    const result = await this.db.query<TaskRow>('SELECT * FROM pr_persistent_tasks WHERE ($1::text IS NULL OR name ILIKE \'%\' || $1 || \'%\') AND ($2::text IS NULL OR status = $2) ORDER BY created_at DESC LIMIT $3 OFFSET $4', [keyword, status, pageSize, (page - 1) * pageSize])
    return { items: result.rows.map(toOutput), total: Number(count.rows[0]?.count ?? 0), page, page_size: pageSize }
  }

  async get(id: string): Promise<PersistentTask> {
    const result = await this.db.query<TaskRow>('SELECT * FROM pr_persistent_tasks WHERE id = $1', [id])
    if (!result.rows[0]) throw new Error('常驻任务不存在。')
    return toOutput(result.rows[0])
  }

  async create(input: PersistentInput): Promise<PersistentTask> {
    validateInput(input)
    const projectId = input.source.project_id ?? input.source.upload_id
    if (!projectId) throw new Error('常驻任务必须使用项目源码。')
    await this.security.requireProjectConfirmation(projectId, input.security, '创建常驻任务')
    const id = `persistent_${crypto.randomUUID()}`
    const source = { ...input.source, security: input.security }
    await this.db.query('INSERT INTO pr_persistent_tasks (id, name, description, source, args, runtime_environment, working_directory, auto_start, restart_policy, restart_delay_seconds, max_restart_count, notification_config) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10, $11, $12::jsonb)', [id, input.name.trim().slice(0, 120), input.description?.trim().slice(0, 500) ?? '', JSON.stringify(source), JSON.stringify(input.args ?? []), input.runtime_environment ?? 'project_venv', input.working_directory ?? null, input.auto_start === true, input.restart_policy ?? 'never', Math.max(0, Math.min(3600, Math.trunc(input.restart_delay_seconds ?? 5))), Math.max(0, Math.min(100, Math.trunc(input.max_restart_count ?? 3))), JSON.stringify(normalizeNotificationConfig(input.notification_config))])
    if (input.auto_start) await this.start(id)
    return this.get(id)
  }

  async update(id: string, input: PersistentInput): Promise<PersistentTask> {
    await this.get(id)
    validateInput(input)
    const projectId = input.source.project_id ?? input.source.upload_id
    if (!projectId) throw new Error('常驻任务必须使用项目源码。')
    await this.security.requireProjectConfirmation(projectId, input.security, '更新常驻任务')
    if (this.active.has(id)) await this.stop(id)
    await this.db.query('UPDATE pr_persistent_tasks SET name = $1, description = $2, source = $3::jsonb, args = $4::jsonb, runtime_environment = $5, working_directory = $6, auto_start = $7, restart_policy = $8, restart_delay_seconds = $9, max_restart_count = $10, notification_config = $11::jsonb, updated_at = NOW() WHERE id = $12', [input.name.trim().slice(0, 120), input.description?.trim().slice(0, 500) ?? '', JSON.stringify({ ...input.source, security: input.security }), JSON.stringify(input.args ?? []), input.runtime_environment ?? 'project_venv', input.working_directory ?? null, input.auto_start === true, input.restart_policy ?? 'never', Math.max(0, Math.min(3600, Math.trunc(input.restart_delay_seconds ?? 5))), Math.max(0, Math.min(100, Math.trunc(input.max_restart_count ?? 3))), JSON.stringify(normalizeNotificationConfig(input.notification_config)), id])
    if (input.auto_start) await this.start(id)
    return this.get(id)
  }

  async remove(id: string): Promise<void> {
    if (this.active.has(id)) await this.stop(id)
    const result = await this.db.query('DELETE FROM pr_persistent_tasks WHERE id = $1', [id])
    if (result.rowCount === 0) throw new Error('常驻任务不存在。')
  }

  async start(id: string): Promise<PersistentTask> {
    if (this.active.has(id)) return this.get(id)
    const task = await this.get(id)
    const projectId = task.source.project_id ?? task.source.upload_id
    if (!projectId) throw new Error('常驻任务项目不存在。')
    await this.security.requireProjectConfirmation(projectId, (task.source as unknown as Record<string, unknown>).security, '启动常驻任务')
    const project = await this.projects.get(projectId)
    const entryFile = task.source.entry_file ?? project.metadata.entry_candidates[0] ?? project.metadata.python_files[0]
    if (!entryFile) throw new Error('项目没有可执行的 Python 入口文件。')
    const sourceEntry = await this.projects.resolveSourcePath(projectId, entryFile)
    if (!(await isFile(sourceEntry))) throw new Error(`入口文件不存在：${entryFile}`)
    const workspace = path.join(config.dataDir, 'persistent', id)
    await rm(workspace, { recursive: true, force: true })
    await copyDirectory(project.sourceRoot, workspace)
    const cwd = task.working_directory ? path.join(workspace, safeRelative(task.working_directory)) : workspace
    if (!(await isDirectory(cwd))) throw new Error('常驻任务工作目录不存在。')
    const executable = await this.pythonExecutable(projectId, task.runtime_environment)
    const logPath = path.join(config.logDir, 'persistent', `${id}.log`)
    await mkdir(path.dirname(logPath), { recursive: true })
    const child = spawn(executable, [path.join(workspace, safeRelative(entryFile)), ...task.args], { cwd, env: executionEnvironment(id, workspace), detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true })
    const active: ActiveProcess = { child, taskId: id, workspace, logPath, stopping: false }
    this.active.set(id, active)
    await this.db.query('UPDATE pr_persistent_tasks SET status = \'running\', pid = $1, started_at = NOW(), stopped_at = NULL, last_heartbeat_at = NOW(), last_error = NULL, updated_at = NOW() WHERE id = $2', [child.pid ?? null, id])
    await this.event(id, 'started', 'stopped', 'running', '常驻任务已启动')
    child.stdout?.on('data', (chunk: Buffer) => void appendOutput(active, chunk.toString('utf8')))
    child.stderr?.on('data', (chunk: Buffer) => void appendOutput(active, chunk.toString('utf8')))
    child.once('exit', (code) => void this.onExit(active, code))
    child.once('error', (error) => void this.onExit(active, -1, error.message))
    return this.get(id)
  }

  async stop(id: string): Promise<PersistentTask> {
    const active = this.active.get(id)
    if (!active) {
      await this.db.query('UPDATE pr_persistent_tasks SET status = \'stopped\', stopped_at = NOW(), pid = NULL, updated_at = NOW() WHERE id = $1', [id])
      return this.get(id)
    }
    active.stopping = true
    await killProcess(active.child)
    this.active.delete(id)
    await this.db.query('UPDATE pr_persistent_tasks SET status = \'stopped\', stopped_at = NOW(), pid = NULL, updated_at = NOW() WHERE id = $1', [id])
    await this.event(id, 'stopped', 'running', 'stopped', '常驻任务已停止')
    return this.get(id)
  }

  async restart(id: string): Promise<PersistentTask> { await this.stop(id); return this.start(id) }

  async logs(id: string, lines = 300): Promise<{ task_id: string; lines: string[]; truncated: boolean; log_size: number; updated_at: string }> {
    const task = await this.get(id)
    const content = await readFile(path.join(config.logDir, 'persistent', `${id}.log`), 'utf8').catch(() => '')
    const all = content.split(/\r?\n/).filter(Boolean)
    return { task_id: id, lines: all.slice(-Math.min(1000, Math.max(1, lines))), truncated: all.length > lines, log_size: Buffer.byteLength(content), updated_at: task.updated_at }
  }

  async clearLogs(id: string): Promise<ReturnType<PersistentManager['logs']>> { await this.get(id); await writeFile(path.join(config.logDir, 'persistent', `${id}.log`), '', 'utf8'); return this.logs(id) }

  async events(id: string, limit = 50): Promise<unknown[]> { await this.get(id); const result = await this.db.query('SELECT id, task_id, event_type, status_before, status_after, message, exit_code, error_summary, created_at FROM pr_persistent_events WHERE task_id = $1 ORDER BY created_at DESC LIMIT $2', [id, Math.min(200, Math.max(1, limit))]); return result.rows }

  async overview(): Promise<{ running: number; failed: number }> { const result = await this.db.query<{ running: string; failed: string }>(`SELECT COUNT(*) FILTER (WHERE status = 'running')::text AS running, COUNT(*) FILTER (WHERE status = 'failed')::text AS failed FROM pr_persistent_tasks`); return { running: Number(result.rows[0]?.running ?? 0), failed: Number(result.rows[0]?.failed ?? 0) } }

  async close(): Promise<void> { for (const timer of this.restartTimers.values()) clearTimeout(timer); await Promise.all([...this.active.keys()].map((id) => this.stop(id).catch(() => undefined))) }

  private async pythonExecutable(projectId: string, environment: string): Promise<string> {
    if (environment !== 'system') { const result = await this.db.query<{ python_executable: string | null; status: string }>('SELECT python_executable, status FROM pr_environment_states WHERE project_id = $1', [projectId]); const executable = result.rows[0]?.python_executable; if (executable && result.rows[0]?.status === 'ready' && await isFile(executable)) return executable; if (environment === 'project_venv') throw new Error('项目虚拟环境未准备好。') }
    return config.pythonExecutable
  }

  private async onExit(active: ActiveProcess, code: number | null, error?: string): Promise<void> {
    if (this.active.get(active.taskId)?.child !== active.child) return
    this.active.delete(active.taskId)
    const task = await this.get(active.taskId).catch(() => null)
    if (!task) return
    const nextStatus = active.stopping ? 'stopped' : code === 0 ? 'stopped' : 'failed'
    await this.db.query('UPDATE pr_persistent_tasks SET status = $1, pid = NULL, stopped_at = NOW(), last_exit_code = $2, last_error = $3, restart_count = CASE WHEN $1 = \'failed\' THEN restart_count + 1 ELSE restart_count END, updated_at = NOW() WHERE id = $4', [nextStatus, code, error ?? (code === 0 ? null : '进程异常退出'), active.taskId])
    await this.event(active.taskId, nextStatus, 'running', nextStatus, error ?? `常驻任务进程退出（${code ?? 'unknown'}）`, code, error)
    if (!active.stopping) {
      const notificationStatus = code === 0 ? 'success' : 'failed'
      const output = await readFile(active.logPath, 'utf8').catch(() => '')
      await this.notifications.notifyExecution({ id: active.taskId, name: task.name, status: notificationStatus, stdout: output, stderr: '', exit_code: code, duration_ms: null }, task.notification_config)
    }
    const shouldRestart = !active.stopping && (task.restart_policy === 'always' || (task.restart_policy === 'on_failure' && code !== 0)) && task.restart_count < task.max_restart_count
    if (shouldRestart) { const timer = setTimeout(() => { this.restartTimers.delete(active.taskId); void this.start(active.taskId).catch(() => undefined) }, task.restart_delay_seconds * 1000); timer.unref(); this.restartTimers.set(active.taskId, timer) }
  }

  private async event(taskId: string, eventType: string, before: string | null, after: string | null, message: string, exitCode: number | null = null, error: string | null = null): Promise<void> { await this.db.query('INSERT INTO pr_persistent_events (id, task_id, event_type, status_before, status_after, message, exit_code, error_summary) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [newId('event'), taskId, eventType, before, after, message, exitCode, error]) }
}

interface TaskRow { id: string; name: string; description: string; source: Record<string, unknown>; args: unknown; runtime_environment: string; working_directory: string | null; status: string; auto_start: boolean; restart_policy: string; restart_delay_seconds: number; max_restart_count: number; notification_config: Record<string, unknown> | null; current_execution_id: string | null; pid: number | null; started_at: Date | string | null; stopped_at: Date | string | null; last_heartbeat_at: Date | string | null; restart_count: number; last_exit_code: number | null; last_error: string | null; created_at: Date | string; updated_at: Date | string }
function toOutput(row: TaskRow): PersistentTask { const source = row.source as unknown as ExecutionSource; return { id: row.id, name: row.name, description: row.description, code: '', source_type: source.type, source_config: { ...source } as Record<string, unknown>, source, args: Array.isArray(row.args) ? row.args.map(String) : [], runtime_environment: row.runtime_environment, working_directory: row.working_directory, status: row.status, auto_start: row.auto_start, restart_policy: row.restart_policy, restart_delay_seconds: row.restart_delay_seconds, max_restart_count: row.max_restart_count, notification_config: normalizeNotificationConfig(row.notification_config), current_execution_id: row.current_execution_id, pid: row.pid, started_at: row.started_at ? new Date(row.started_at).toISOString() : null, stopped_at: row.stopped_at ? new Date(row.stopped_at).toISOString() : null, last_heartbeat_at: row.last_heartbeat_at ? new Date(row.last_heartbeat_at).toISOString() : null, restart_count: row.restart_count, last_exit_code: row.last_exit_code, last_error: row.last_error, created_at: new Date(row.created_at).toISOString(), updated_at: new Date(row.updated_at).toISOString() } }
function validateInput(input: PersistentInput): void { if (!input.name?.trim()) throw new Error('常驻任务名称不能为空。'); if (input.source?.type !== 'archive' || !(input.source.project_id ?? input.source.upload_id)) throw new Error('常驻任务必须绑定项目源码。') }
function safeRelative(value: string): string { const normalized = value.replaceAll('\\', '/').trim(); if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('任务路径必须位于项目目录内。'); return normalized }
async function copyDirectory(source: string, destination: string): Promise<void> { await mkdir(destination, { recursive: true }); const { readdir, readFile, writeFile } = await import('node:fs/promises'); for (const entry of await readdir(source, { withFileTypes: true })) { const from = path.join(source, entry.name); const to = path.join(destination, entry.name); if (entry.isDirectory()) await copyDirectory(from, to); else if (entry.isFile()) await writeFile(to, await readFile(from), { flag: 'wx' }) } }
async function appendOutput(active: ActiveProcess, content: string): Promise<void> { await appendFile(active.logPath, content, 'utf8').catch(() => undefined); const size = await stat(active.logPath).then((value) => value.size).catch(() => 0); if (size > 5 * 1024 * 1024) { const data = await readFile(active.logPath, 'utf8').catch(() => ''); await writeFile(active.logPath, data.slice(-5 * 1024 * 1024), 'utf8') } }
function executionEnvironment(id: string, workspace: string): NodeJS.ProcessEnv { return { PATH: process.env.PATH, PATHEXT: process.env.PATHEXT, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, PYTHONUNBUFFERED: '1', TOOLNEST_EXECUTION_ID: id, TOOLNEST_EXECUTION_WORKSPACE: workspace } }
async function isFile(filePath: string): Promise<boolean> { return stat(filePath).then((value) => value.isFile()).catch(() => false) }
async function isDirectory(filePath: string): Promise<boolean> { return stat(filePath).then((value) => value.isDirectory()).catch(() => false) }
async function killProcess(child: ChildProcess): Promise<void> { if (!child.pid) return; if (process.platform === 'win32') { await new Promise<void>((resolve) => { const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); killer.once('exit', () => resolve()); killer.once('error', () => resolve()) }); return } try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill('SIGTERM') } }
