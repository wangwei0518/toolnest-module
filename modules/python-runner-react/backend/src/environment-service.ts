import { execFile, type ExecFileException } from 'node:child_process'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { config } from './config.js'
import { Database } from './db.js'
import { ProjectService } from './project-service.js'
import { SecurityService } from './security-service.js'

const execFileAsync = promisify(execFile)

export interface ProjectEnvironment {
  upload_id: string
  status: string
  python_executable: string | null
  venv_path: string
  project_dir: string
  data_dir: string
  data_size: number
  requirements_path: string | null
  has_requirements: boolean
  risky_requirements: Array<Record<string, string>>
  last_install_status: string | null
  last_install_at: string | null
  last_install_exit_code: number | null
  last_error: string | null
  requirements_changed: boolean
  created_at: string | null
  updated_at: string | null
}

export class EnvironmentService {
  constructor(private readonly db: Database, private readonly projects: ProjectService, private readonly security: SecurityService) {}

  async get(projectId: string): Promise<ProjectEnvironment> {
    const project = await this.projects.get(projectId)
    const scan = await this.security.getProjectSecurity(projectId)
    const state = await this.db.query<EnvironmentRow>('SELECT * FROM pr_environment_states WHERE project_id = $1', [projectId])
    const row = state.rows[0]
    const requirements = project.metadata.dependency_files.find((file) => path.basename(file).toLowerCase() === 'requirements.txt') ?? null
    const venvPath = row?.venv_path ?? path.join(this.projects.projectRoot(projectId), 'venv')
    const executable = row?.python_executable ?? pythonPath(venvPath)
    return {
      upload_id: projectId,
      status: row?.status ?? 'missing',
      python_executable: row?.python_executable ?? (await exists(executable) ? executable : null),
      venv_path: venvPath,
      project_dir: project.sourceRoot,
      data_dir: path.join(this.projects.projectRoot(projectId), 'data'),
      data_size: await directorySize(path.join(this.projects.projectRoot(projectId), 'data')),
      requirements_path: requirements ? path.join(project.sourceRoot, requirements) : null,
      has_requirements: Boolean(requirements),
      risky_requirements: scan.findings.filter((finding) => finding.category === 'requirements').map((finding) => ({ line: String(finding.line ?? ''), token: finding.token ?? '', content: finding.content ?? finding.message, level: finding.level, scan_id: scan.scan_id })),
      last_install_status: row?.last_install_status ?? null,
      last_install_at: row?.last_install_at ? asIso(row.last_install_at) : null,
      last_install_exit_code: row?.last_install_exit_code ?? null,
      last_error: row?.last_error ?? null,
      requirements_changed: Boolean(project.row.requirements_hash && project.row.requirements_hash !== row?.requirements_hash),
      created_at: row?.created_at ? asIso(row.created_at) : null,
      updated_at: row?.updated_at ? asIso(row.updated_at) : null,
    }
  }

  async create(projectId: string): Promise<ProjectEnvironment> {
    const project = await this.projects.get(projectId)
    const venvPath = path.join(this.projects.projectRoot(projectId), 'venv')
    await mkdir(path.dirname(venvPath), { recursive: true })
    await this.db.query(
      `INSERT INTO pr_environment_states (project_id, status, venv_path, requirements_path, requirements_hash)
       VALUES ($1, 'creating', $2, $3, $4)
       ON CONFLICT (project_id) DO UPDATE SET status = 'creating', venv_path = EXCLUDED.venv_path, requirements_path = EXCLUDED.requirements_path, requirements_hash = EXCLUDED.requirements_hash, updated_at = NOW()`,
      [projectId, venvPath, requirementsPath(project), project.row.requirements_hash],
    )
    try {
      await rm(venvPath, { recursive: true, force: true })
      await run(config.pythonExecutable, ['-m', 'venv', venvPath], project.sourceRoot, 180_000)
      await this.db.query('UPDATE pr_environment_states SET status = \'ready\', python_executable = $1, last_error = NULL, updated_at = NOW() WHERE project_id = $2', [pythonPath(venvPath), projectId])
    } catch (error) {
      await this.db.query('UPDATE pr_environment_states SET status = \'failed\', last_error = $1, updated_at = NOW() WHERE project_id = $2', [errorMessage(error), projectId])
      throw new Error(`创建 Python 虚拟环境失败：${errorMessage(error)}`)
    }
    return this.get(projectId)
  }

  async installRequirements(projectId: string, input: { confirm_risk?: boolean; strict?: boolean; scan_id?: string }): Promise<ProjectEnvironment> {
    const project = await this.projects.get(projectId)
    await this.security.requireProjectConfirmation(projectId, { risk_confirmed: input.confirm_risk, scan_id: input.scan_id }, '安装依赖')
    const environment = await this.get(projectId)
    if (!environment.python_executable) await this.create(projectId)
    const current = await this.get(projectId)
    const requirements = requirementsPath(project)
    if (!requirements) return current
    const logPath = path.join(config.logDir, 'projects', `${projectId}.install.log`)
    await mkdir(path.dirname(logPath), { recursive: true })
    await writeFile(logPath, '', 'utf8')
    try {
      const result = await run(current.python_executable ?? pythonPath(current.venv_path), ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '--requirement', requirements], project.sourceRoot, 600_000, logPath)
      await this.db.query('UPDATE pr_environment_states SET status = \'ready\', requirements_hash = $1, last_install_status = \'success\', last_install_at = NOW(), last_install_exit_code = $2, last_error = NULL, updated_at = NOW() WHERE project_id = $3', [project.row.requirements_hash, result.exitCode, projectId])
    } catch (error) {
      await this.db.query('UPDATE pr_environment_states SET last_install_status = \'failed\', last_install_at = NOW(), last_install_exit_code = $1, last_error = $2, updated_at = NOW() WHERE project_id = $3', [-1, errorMessage(error), projectId])
      throw new Error(`安装 Python 依赖失败：${errorMessage(error)}`)
    }
    return this.get(projectId)
  }

  async rebuild(projectId: string): Promise<ProjectEnvironment> {
    await this.delete(projectId)
    return this.create(projectId)
  }

  async delete(projectId: string): Promise<ProjectEnvironment> {
    await this.projects.get(projectId)
    const venvPath = path.join(this.projects.projectRoot(projectId), 'venv')
    await rm(venvPath, { recursive: true, force: true })
    await this.db.query('DELETE FROM pr_environment_states WHERE project_id = $1', [projectId])
    return this.get(projectId)
  }

  async installLog(projectId: string): Promise<{ content: string; truncated: boolean }> {
    await this.projects.get(projectId)
    const logPath = path.join(config.logDir, 'projects', `${projectId}.install.log`)
    const content = await readFile(logPath, 'utf8').catch(() => '')
    const limit = 2 * 1024 * 1024
    return { content: content.slice(-limit), truncated: content.length > limit }
  }

  async clearData(projectId: string): Promise<ProjectEnvironment> {
    await this.projects.get(projectId)
    await rm(path.join(this.projects.projectRoot(projectId), 'data'), { recursive: true, force: true })
    return this.get(projectId)
  }
}

interface EnvironmentRow {
  status: string
  python_executable: string | null
  venv_path: string
  requirements_path: string | null
  requirements_hash: string | null
  last_install_status: string | null
  last_install_at: Date | string | null
  last_install_exit_code: number | null
  last_error: string | null
  created_at: Date | string
  updated_at: Date | string
}

function pythonPath(venvPath: string): string {
  return process.platform === 'win32' ? path.join(venvPath, 'Scripts', 'python.exe') : path.join(venvPath, 'bin', 'python')
}

function requirementsPath(project: { sourceRoot: string; metadata: { dependency_files: string[] } }): string | null {
  const relative = project.metadata.dependency_files.find((file) => path.basename(file).toLowerCase() === 'requirements.txt')
  return relative ? path.join(project.sourceRoot, relative) : null
}

async function run(command: string, args: string[], cwd: string, timeout: number, logPath?: string): Promise<{ exitCode: number }> {
  try {
    await execFileAsync(command, args, { cwd, timeout, windowsHide: true, shell: false, env: safeEnvironment(), maxBuffer: 2 * 1024 * 1024 })
    return { exitCode: 0 }
  } catch (error) {
    const failure = error as ExecFileException & { code?: number | string; stdout?: string; stderr?: string }
    if (logPath) await writeFile(logPath, `${failure.stdout ?? ''}\n${failure.stderr ?? ''}`.slice(-2 * 1024 * 1024), 'utf8')
    throw new Error(`${errorMessage(error)}${failure.stderr ? `：${failure.stderr.slice(-1000)}` : ''}`)
  }
}

function safeEnvironment(): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH, PATHEXT: process.env.PATHEXT, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, PYTHONUNBUFFERED: '1' }
}

async function exists(filePath: string): Promise<boolean> {
  return stat(filePath).then(() => true).catch(() => false)
}

async function directorySize(root: string): Promise<number> {
  const entries = await import('node:fs/promises').then(({ readdir }) => readdir(root, { withFileTypes: true })).catch(() => [])
  let size = 0
  for (const entry of entries) {
    const item = path.join(root, entry.name)
    if (entry.isDirectory()) size += await directorySize(item)
    else if (entry.isFile()) size += (await stat(item)).size
  }
  return size
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
