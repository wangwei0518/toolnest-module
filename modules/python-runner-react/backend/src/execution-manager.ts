import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { takeUtf8Prefix, Utf8StreamDecoder } from './utf8-stream.js'
import { config } from './config.js'
import { Database } from './db.js'
import { newId } from './ids.js'
import { normalizeNotificationConfig, NotificationService } from './notification-service.js'
import { ProjectService } from './project-service.js'
import { SecurityService } from './security-service.js'
import type { PythonExecution } from './types.js'

interface ActiveExecution {
  child: ChildProcess
  workspacePath: string
  stdoutPath: string
  stderrPath: string
  stdout: string
  stderr: string
  truncated: boolean
  stopped: boolean
}

export interface ExecutionSource {
  type: 'inline' | 'archive'
  code?: string
  project_id?: string
  upload_id?: string
  entry_file?: string
}

export interface CreateExecutionInput {
  name: string
  source: ExecutionSource
  args: string[]
  timeoutSeconds: number
  runtimeEnvironment: 'auto' | 'project_venv' | 'system'
  security?: unknown
  taskMode?: string
  triggerType?: string
  triggerId?: string | null
  workingDirectory?: string | null
  notificationConfig?: unknown
  notificationRecovered?: boolean
}

export class ExecutionManager {
  private readonly active = new Map<string, ActiveExecution>()

  constructor(private readonly db: Database, private readonly projects: ProjectService, private readonly security: SecurityService, private readonly notifications: NotificationService) {}

  async create(input: CreateExecutionInput): Promise<PythonExecution> {
    if (this.active.size >= config.maxConcurrentExecutions) throw new Error('当前执行任务已达到并发上限，请稍后重试。')
    const args = validateArgs(input.args)
    const timeoutSeconds = Math.min(config.maxExecutionSeconds, Math.max(1, Math.trunc(input.timeoutSeconds)))
    const notificationConfig = input.notificationConfig === undefined ? null : normalizeNotificationConfig(input.notificationConfig)
    const id = newId('exec')
    const workspacePath = path.join(config.dataDir, 'workspaces', id)
    const stdoutPath = path.join(config.logDir, 'executions', `${id}.stdout`)
    const stderrPath = path.join(config.logDir, 'executions', `${id}.stderr`)
    await mkdir(workspacePath, { recursive: true })
    await mkdir(path.dirname(stdoutPath), { recursive: true })
    await writeFile(stdoutPath, '', 'utf8')
    await writeFile(stderrPath, '', 'utf8')

    let projectId: string | null = null
    let sourceSnapshotPath: string | null = null
    let codeSnapshot = ''
    let entryFile = 'main.py'
    let workingDirectory: string | null = input.workingDirectory ?? null
    let sourceConfig: Record<string, unknown>
    try {
      if (input.source.type === 'inline') {
        if (!input.source.code?.trim()) throw new Error('Python 代码不能为空。')
        this.security.requireInlineConfirmation(input.source.code, input.security, '运行代码')
        codeSnapshot = input.source.code
        sourceConfig = { type: 'inline', ...(notificationConfig ? { notification_config: notificationConfig } : {}) }
        await writeFile(path.join(workspacePath, entryFile), input.source.code, 'utf8')
      } else {
        projectId = input.source.project_id ?? input.source.upload_id ?? null
        if (!projectId) throw new Error('项目执行必须提供 project_id。')
        await this.security.requireProjectConfirmation(projectId, input.security, '运行项目')
        const project = await this.projects.get(projectId)
        entryFile = input.source.entry_file?.trim() || project.metadata.entry_candidates[0] || project.metadata.python_files[0] || ''
        if (!entryFile) throw new Error('项目没有可执行的 Python 入口文件。')
        const sourceEntry = await this.projects.resolveSourcePath(projectId, entryFile)
        if (!(await isFile(sourceEntry))) throw new Error(`入口文件不存在：${entryFile}`)
        await copyDirectory(project.sourceRoot, workspacePath)
        codeSnapshot = (await readFile(sourceEntry, 'utf8').catch(() => '')).slice(0, 1_048_576)
        sourceSnapshotPath = project.sourceRoot
        sourceConfig = { type: 'archive', project_id: projectId, upload_id: projectId, entry_file: entryFile, ...(notificationConfig ? { notification_config: notificationConfig } : {}) }
        workingDirectory = safeRelative(workingDirectory)
      }
      const command = await this.resolvePython(projectId, input.runtimeEnvironment)
      const cwd = workingDirectory ? path.join(workspacePath, workingDirectory) : workspacePath
      if (!(await isDirectory(cwd))) throw new Error('工作目录不存在或不是目录。')
      const entryPath = path.join(workspacePath, safeRelative(entryFile))
      await this.db.query(
        `INSERT INTO pr_executions (id, name, project_id, task_mode, trigger_type, trigger_id, source_type, source_config, source_snapshot_path, code_snapshot, entry_file, working_directory, args, timeout_seconds, status, stdout_path, stderr_path, workspace_path)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13::jsonb, $14, 'pending', $15, $16, $17)`,
        [id, input.name.trim().slice(0, 120) || '未命名脚本', projectId, input.taskMode ?? 'once', input.triggerType ?? 'manual', input.triggerId ?? null, input.source.type, JSON.stringify(sourceConfig), sourceSnapshotPath, codeSnapshot, entryFile, workingDirectory, JSON.stringify(args), timeoutSeconds, stdoutPath, stderrPath, workspacePath],
      )
      const startedAt = new Date().toISOString()
      await this.db.query('UPDATE pr_executions SET status = $1, started_at = $2, updated_at = $2 WHERE id = $3', ['running', startedAt, id])
      const child = spawn(command, [entryPath, ...args], { cwd, env: executionEnvironment(id, workspacePath), detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true })
      const active: ActiveExecution = { child, workspacePath, stdoutPath, stderrPath, stdout: '', stderr: '', truncated: false, stopped: false }
      this.active.set(id, active)
      const stdoutDecoder = new Utf8StreamDecoder()
      const stderrDecoder = new Utf8StreamDecoder()
      child.stdout?.on('data', (chunk: Buffer) => this.capture(active, stdoutDecoder.write(chunk), false))
      child.stderr?.on('data', (chunk: Buffer) => this.capture(active, stderrDecoder.write(chunk), true))
      child.stdout?.once('end', () => this.capture(active, stdoutDecoder.end(), false))
      child.stderr?.once('end', () => this.capture(active, stderrDecoder.end(), true))
      const result = await this.waitForExit(id, child, timeoutSeconds)
      this.active.delete(id)
      await writeFile(stdoutPath, active.stdout, 'utf8')
      await writeFile(stderrPath, active.stderr, 'utf8')
      const finishedAt = new Date().toISOString()
      const status = active.stopped ? 'stopped' : result.timedOut ? 'timeout' : result.signal ? 'timeout' : result.exitCode === 0 ? 'success' : 'failed'
      const durationMs = Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime())
      await this.db.query('UPDATE pr_executions SET status = $1, stdout = $2, stderr = $3, exit_code = $4, logs_truncated = $5, finished_at = $6, duration_ms = $7, updated_at = $6 WHERE id = $8', [status, active.stdout, active.stderr, result.exitCode, active.truncated, finishedAt, durationMs, id])
      await rm(workspacePath, { recursive: true, force: true }).catch(() => undefined)
      const output = await this.get(id)
      if (notificationConfig) await this.notifications.notifyExecution(output, notificationConfig, input.notificationRecovered === true)
      return output
    } catch (error) {
      await rm(workspacePath, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }

  async createInline(input: Omit<CreateExecutionInput, 'source'> & { code: string }): Promise<PythonExecution> {
    return this.create({ ...input, source: { type: 'inline', code: input.code } })
  }

  async stop(id: string): Promise<PythonExecution> {
    if (this.active.has(id)) await this.stopProcess(id)
    return this.get(id)
  }

  async rerun(id: string): Promise<PythonExecution> {
    const execution = await this.get(id)
    const source = execution.source_type === 'inline'
      ? { type: 'inline' as const, code: execution.code_snapshot }
      : { type: 'archive' as const, project_id: String(execution.source_config.project_id ?? execution.source_config.upload_id ?? ''), entry_file: execution.entry_file }
    return this.create({ name: execution.name, source, args: execution.args, timeoutSeconds: execution.timeout_seconds, runtimeEnvironment: 'auto', workingDirectory: execution.working_directory, notificationConfig: execution.source_config.notification_config })
  }

  async remove(id: string): Promise<void> {
    if (this.active.has(id)) throw new Error('运行中的执行记录不能删除，请先停止任务。')
    const result = await this.db.query('DELETE FROM pr_executions WHERE id = $1', [id])
    if (result.rowCount === 0) throw new Error('执行记录不存在。')
  }

  async list(): Promise<PythonExecution[]> {
    const result = await this.db.query<ExecutionRow>('SELECT * FROM pr_executions ORDER BY created_at DESC LIMIT 100')
    return Promise.all(result.rows.map((row) => this.toOutput(row)))
  }

  async get(id: string): Promise<PythonExecution> {
    const result = await this.db.query<ExecutionRow>('SELECT * FROM pr_executions WHERE id = $1', [id])
    const row = result.rows[0]
    if (!row) throw new Error('执行记录不存在。')
    return this.toOutput(row)
  }

  async logs(id: string, limit = 200, after?: string): Promise<Array<{ type: string; content: string; timestamp: string; cursor: string }>> {
    const execution = await this.get(id)
    const timestamp = execution.updated_at
    const events = [
      ...execution.stdout.split(/\r?\n/).filter(Boolean).slice(-limit).map((content) => ({ type: 'stdout', content, timestamp })),
      ...execution.stderr.split(/\r?\n/).filter(Boolean).slice(-limit).map((content) => ({ type: 'stderr', content, timestamp })),
    ]
    const offset = after && /^\d+$/.test(after) ? Number(after) : 0
    return events.slice(offset, offset + limit).map((event, index) => ({ ...event, cursor: String(offset + index + 1) }))
  }

  async close(): Promise<void> {
    await Promise.all([...this.active.keys()].map((id) => this.stop(id).catch(() => undefined)))
  }

  private async resolvePython(projectId: string | null, environment: 'auto' | 'project_venv' | 'system'): Promise<string> {
    if (projectId && environment !== 'system') {
      const state = await this.db.query<{ python_executable: string | null; status: string }>('SELECT python_executable, status FROM pr_environment_states WHERE project_id = $1', [projectId])
      const executable = state.rows[0]?.python_executable
      if (executable && state.rows[0]?.status === 'ready' && await isFile(executable)) return executable
      if (environment === 'project_venv') throw new Error('项目虚拟环境未准备好，请先创建环境。')
    }
    return config.pythonExecutable
  }

  private async waitForExit(id: string, child: ChildProcess, timeoutSeconds: number): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null; timedOut: boolean }> {
    return new Promise((resolve) => {
      let settled = false
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        if (child.exitCode === null) void this.stopProcess(id)
      }, timeoutSeconds * 1000)
      timer.unref()
      const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve({ exitCode, signal, timedOut })
      }
      child.once('error', () => finish(-1, null))
      child.once('close', (exitCode, signal) => finish(exitCode, signal))
    })
  }

  private capture(active: ActiveExecution, chunk: string, error: boolean): void {
    if (!chunk) return
    const current = error ? active.stderr : active.stdout
    const remaining = config.maxOutputBytes - Buffer.byteLength(current, 'utf8')
    if (remaining <= 0) {
      active.truncated = true
      return
    }
    const next = takeUtf8Prefix(chunk, remaining)
    if (error) active.stderr += next
    else active.stdout += next
    if (next.length < chunk.length) active.truncated = true
  }

  private async stopProcess(id: string): Promise<void> {
    const active = this.active.get(id)
    if (!active || active.child.exitCode !== null) return
    active.stopped = true
    const pid = active.child.pid
    if (!pid) return
    if (process.platform === 'win32') {
      await new Promise<void>((resolve) => {
        const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
        killer.once('exit', () => resolve())
        killer.once('error', () => resolve())
      })
      return
    }
    try { process.kill(-pid, 'SIGTERM') } catch { active.child.kill('SIGTERM') }
  }

  private async toOutput(row: ExecutionRow): Promise<PythonExecution> {
    return {
      id: row.id, name: row.name ?? '未命名脚本', task_mode: row.task_mode, trigger_type: row.trigger_type, trigger_id: row.trigger_id,
      source_type: row.source_type, source_config: row.source_config ?? {}, source_snapshot_path: row.source_snapshot_path, code_snapshot: row.code_snapshot, entry_file: row.entry_file,
      working_directory: row.working_directory, args: parseJsonArray(row.args), timeout_seconds: row.timeout_seconds, status: row.status,
      stdout: row.stdout ?? await this.readLimited(row.stdout_path), stderr: row.stderr ?? await this.readLimited(row.stderr_path), stdout_path: row.stdout_path, stderr_path: row.stderr_path,
      logs_truncated: row.logs_truncated, exit_code: row.exit_code, workspace_path: row.workspace_path, started_at: row.started_at ? asIso(row.started_at) : null,
      finished_at: row.finished_at ? asIso(row.finished_at) : null, duration_ms: row.duration_ms, created_at: asIso(row.created_at), updated_at: asIso(row.updated_at),
    }
  }

  private async readLimited(filePath: string | null): Promise<string> {
    if (!filePath) return ''
    return readFile(filePath, 'utf8').then((content) => content.slice(-config.maxOutputBytes)).catch(() => '')
  }
}

interface ExecutionRow {
  id: string
  name: string | null
  task_mode: string
  trigger_type: string
  trigger_id: string | null
  source_type: string
  source_config: Record<string, unknown> | null
  source_snapshot_path: string | null
  code_snapshot: string
  entry_file: string
  working_directory: string | null
  args: unknown
  timeout_seconds: number
  status: string
  stdout: string | null
  stderr: string | null
  stdout_path: string | null
  stderr_path: string | null
  logs_truncated: boolean
  exit_code: number | null
  workspace_path: string | null
  started_at: Date | string | null
  finished_at: Date | string | null
  duration_ms: number | null
  created_at: Date | string
  updated_at: Date | string
}

function validateArgs(args: string[]): string[] {
  if (!Array.isArray(args) || args.length > 64) throw new Error('命令行参数不能超过 64 个。')
  const normalized = args.map(String)
  if (normalized.some((arg) => Buffer.byteLength(arg, 'utf8') > 1024 || /[\u0000-\u001f\u007f]/.test(arg)) || Buffer.byteLength(normalized.join(''), 'utf8') > 8192) throw new Error('命令行参数包含不允许的字符或长度超限。')
  return normalized
}

function executionEnvironment(id: string, workspace: string): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH, PATHEXT: process.env.PATHEXT, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', TOOLNEST_EXECUTION_ID: id, TOOLNEST_EXECUTION_WORKSPACE: workspace }
}

function safeRelative(relative: string | null | undefined): string {
  const value = (relative ?? '').replaceAll('\\', '/').trim()
  if (!value) return ''
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value) || value.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('路径必须位于项目目录内。')
  return value
}

async function copyDirectory(source: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true })
  const { readdir } = await import('node:fs/promises')
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name)
    const to = path.join(destination, entry.name)
    if (entry.isDirectory()) await copyDirectory(from, to)
    else if (entry.isFile()) await writeFile(to, await readFile(from), { flag: 'wx' })
  }
}

async function isFile(filePath: string): Promise<boolean> { return stat(filePath).then((value) => value.isFile()).catch(() => false) }
async function isDirectory(filePath: string): Promise<boolean> { return stat(filePath).then((value) => value.isDirectory()).catch(() => false) }
function parseJsonArray(value: unknown): string[] { return Array.isArray(value) ? value.map(String) : [] }
function asIso(value: Date | string): string { return value instanceof Date ? value.toISOString() : new Date(value).toISOString() }
