import AdmZip from 'adm-zip'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Database } from './db.js'
import { config } from './config.js'
import { newId } from './ids.js'
import type { ProjectSummary } from './types.js'

const MAX_FILES = 10_000
const MAX_UNPACKED_BYTES = 512 * 1024 * 1024
const MAX_FILE_BYTES = 64 * 1024 * 1024
const MAX_TREE_NODES = 5_000
const BACKUP_RETENTION = 3

export interface ProjectUpload {
  id: string
  name: string
  filename: string
  upload_source: string
  source_type: 'archive'
  file_count: number
  total_size: number
  entry_candidates: string[]
  python_files: string[]
  dependency_files: string[]
  file_tree: ProjectFileNode[]
  status: string
  error_message: string | null
  created_at: string
  updated_at: string
}

export interface ProjectFileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: ProjectFileNode[]
}

export interface ProjectUpdateResult {
  id: string
  name?: string
  updated?: boolean
  rolled_back?: boolean
  backup_id?: string | null
  source_hash_changed?: boolean
  requirements_changed?: boolean
  old_requirements_hash?: string | null
  new_requirements_hash?: string | null
  entry_candidates?: string[]
  dependency_files?: string[]
  security_scan?: unknown
  impacted_tasks: unknown[]
  missing_entry_tasks: unknown[]
  message: string
}

export class ProjectImpactError extends Error {
  readonly statusCode = 409
  constructor(readonly impact: { impacted_tasks: unknown[]; missing_entry_tasks: unknown[] }) {
    super('项目更新会影响已有任务，请确认后继续。')
    this.name = 'ProjectImpactError'
  }
}

interface ProjectMetadata {
  filename: string
  upload_source: string
  file_count: number
  total_size: number
  entry_candidates: string[]
  python_files: string[]
  dependency_files: string[]
  file_tree: ProjectFileNode[]
  source_hash: string
  requirements_hash: string | null
  update_count: number
  last_backup_id: string | null
  error_message: string | null
}

interface CreateProjectInput {
  archivePath: string
  name?: string
  filename: string
  uploadSource?: string
}

export class ProjectService {
  constructor(private readonly db: Database) {}

  async createFromArchive(input: CreateProjectInput): Promise<ProjectUpload> {
    const projectId = newId('project')
    const archiveBytes = await readFile(input.archivePath)
    if (archiveBytes.byteLength === 0) throw new Error('项目压缩包不能为空。')
    const releaseId = newId('release')
    const projectRoot = this.projectRoot(projectId)
    const sourceRoot = path.join(projectRoot, 'releases', releaseId, 'source')
    await mkdir(sourceRoot, { recursive: true })
    try {
      const analyzed = await extractArchive(archiveBytes, sourceRoot)
      const sourceHash = await hashDirectory(sourceRoot)
      const requirementsHash = await requirementsHashFor(sourceRoot, analyzed.dependencyFiles)
      const metadata: ProjectMetadata = {
        filename: input.filename,
        upload_source: input.uploadSource === 'folder' ? 'folder' : 'zip',
        file_count: analyzed.fileCount,
        total_size: analyzed.totalSize,
        entry_candidates: analyzed.entryCandidates,
        python_files: analyzed.pythonFiles,
        dependency_files: analyzed.dependencyFiles,
        file_tree: analyzed.fileTree,
        source_hash: sourceHash,
        requirements_hash: requirementsHash,
        update_count: 0,
        last_backup_id: null,
        error_message: null,
      }
      await writeFile(path.join(path.dirname(sourceRoot), 'release.json'), JSON.stringify(metadata, null, 2), 'utf8')
      await writeFile(path.join(projectRoot, 'project.json'), JSON.stringify(metadata, null, 2), 'utf8')
      await writeFile(path.join(projectRoot, 'archive.zip'), archiveBytes)
      await this.db.query(
        `INSERT INTO pr_projects (id, name, status, active_release_id, source_hash, requirements_hash)
         VALUES ($1, $2, 'ready', $3, $4, $5)`,
        [projectId, input.name?.trim().slice(0, 120) || path.basename(input.filename, path.extname(input.filename)) || '未命名项目', releaseId, sourceHash, requirementsHash],
      )
      await this.db.query(
        `INSERT INTO pr_project_releases (id, project_id, root_path, source_hash, requirements_hash, entry_candidates, dependency_files, active)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, TRUE)`,
        [releaseId, projectId, sourceRoot, sourceHash, requirementsHash, JSON.stringify(analyzed.entryCandidates), JSON.stringify(analyzed.dependencyFiles)],
      )
      return this.getUpload(projectId)
    } catch (error) {
      await rm(projectRoot, { recursive: true, force: true }).catch(() => undefined)
      throw error
    } finally {
      await rm(input.archivePath, { force: true }).catch(() => undefined)
    }
  }

  async list(status?: string): Promise<ProjectUpload[]> {
    const result = await this.db.query<ProjectRow>(
      `SELECT p.*, r.root_path
       FROM pr_projects p
       LEFT JOIN pr_project_releases r ON r.project_id = p.id AND r.id = p.active_release_id
       WHERE ($1::text IS NULL OR p.status = $1)
       ORDER BY p.updated_at DESC LIMIT 100`,
      [status ?? null],
    )
    return Promise.all(result.rows.map((row) => this.toUpload(row)))
  }

  async listSummaries(): Promise<ProjectSummary[]> {
    const result = await this.db.query<ProjectSummary>(
      'SELECT id, name, status, active_release_id, source_hash, requirements_hash, created_at, updated_at FROM pr_projects ORDER BY updated_at DESC LIMIT 100',
    )
    return result.rows.map((row) => ({ ...row, created_at: asIso(row.created_at), updated_at: asIso(row.updated_at) }))
  }

  async getUpload(projectId: string): Promise<ProjectUpload> {
    const result = await this.db.query<ProjectRow>(
      `SELECT p.*, r.root_path
       FROM pr_projects p
       LEFT JOIN pr_project_releases r ON r.project_id = p.id AND r.id = p.active_release_id
       WHERE p.id = $1`,
      [projectId],
    )
    const row = result.rows[0]
    if (!row || row.status === 'deleted') throw new Error('项目不存在。')
    return this.toUpload(row)
  }

  async get(projectId: string): Promise<ProjectRecord> {
    const result = await this.db.query<ProjectRow>(
      `SELECT p.*, r.root_path
       FROM pr_projects p
       LEFT JOIN pr_project_releases r ON r.project_id = p.id AND r.id = p.active_release_id
       WHERE p.id = $1`,
      [projectId],
    )
    const row = result.rows[0]
    if (!row || row.status === 'deleted' || !row.root_path) throw new Error('项目不存在。')
    const metadata = await this.readMetadata(projectId)
    return { row, metadata, sourceRoot: row.root_path }
  }

  async delete(projectId: string): Promise<void> {
    await this.get(projectId)
    await this.db.query('UPDATE pr_projects SET status = \'deleted\', updated_at = NOW() WHERE id = $1', [projectId])
    await rm(this.projectRoot(projectId), { recursive: true, force: true })
  }

  async updateFromArchive(projectId: string, input: Omit<CreateProjectInput, 'name'> & { name?: string; confirmScheduleImpact?: boolean }): Promise<ProjectUpdateResult> {
    const current = await this.get(projectId)
    const releaseId = newId('release')
    const updateRoot = path.join(this.projectRoot(projectId), 'updates', releaseId)
    const sourceRoot = path.join(updateRoot, 'source')
    const archiveBytes = await readFile(input.archivePath)
    await mkdir(sourceRoot, { recursive: true })
    try {
      const analyzed = await extractArchive(archiveBytes, sourceRoot)
      const sourceHash = await hashDirectory(sourceRoot)
      const requirementsHash = await requirementsHashFor(sourceRoot, analyzed.dependencyFiles)
      const oldReleaseId = current.row.active_release_id
      const backupId = oldReleaseId ? newId('backup') : null
      const impact = await this.findImpactedTasks(projectId, analyzed.entryCandidates)
      if (impact.impacted_tasks.length > 0 && input.confirmScheduleImpact !== true) throw new ProjectImpactError(impact)
      if (oldReleaseId) await this.copyReleaseToBackup(projectId, oldReleaseId, backupId!)
      const stableReleaseRoot = path.join(this.projectRoot(projectId), 'releases', releaseId)
      await mkdir(path.dirname(stableReleaseRoot), { recursive: true })
      await moveDirectory(updateRoot, stableReleaseRoot)
      const metadata: ProjectMetadata = {
        filename: input.filename,
        upload_source: input.uploadSource === 'folder' ? 'folder' : 'zip',
        file_count: analyzed.fileCount,
        total_size: analyzed.totalSize,
        entry_candidates: analyzed.entryCandidates,
        python_files: analyzed.pythonFiles,
        dependency_files: analyzed.dependencyFiles,
        file_tree: analyzed.fileTree,
        source_hash: sourceHash,
        requirements_hash: requirementsHash,
        update_count: current.metadata.update_count + 1,
        last_backup_id: backupId,
        error_message: null,
      }
      await writeFile(path.join(stableReleaseRoot, 'release.json'), JSON.stringify(metadata, null, 2), 'utf8')
      await this.db.query('UPDATE pr_project_releases SET active = FALSE WHERE project_id = $1', [projectId])
      await this.db.query(
        `INSERT INTO pr_project_releases (id, project_id, root_path, source_hash, requirements_hash, entry_candidates, dependency_files, active)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, TRUE)`,
        [releaseId, projectId, path.join(stableReleaseRoot, 'source'), sourceHash, requirementsHash, JSON.stringify(analyzed.entryCandidates), JSON.stringify(analyzed.dependencyFiles)],
      )
      await this.db.query('UPDATE pr_projects SET name = COALESCE(NULLIF($1, \'\'), name), active_release_id = $2, source_hash = $3, requirements_hash = $4, updated_at = NOW() WHERE id = $5', [input.name?.trim().slice(0, 120) ?? '', releaseId, sourceHash, requirementsHash, projectId])
      await writeFile(path.join(this.projectRoot(projectId), 'project.json'), JSON.stringify(metadata, null, 2), 'utf8')
      await writeFile(path.join(this.projectRoot(projectId), 'archive.zip'), archiveBytes)
      await this.pruneReleases(projectId, releaseId)
      return {
        id: projectId,
        name: input.name?.trim() || current.row.name,
        updated: true,
        backup_id: backupId,
        source_hash_changed: current.row.source_hash !== sourceHash,
        requirements_changed: current.row.requirements_hash !== requirementsHash,
        old_requirements_hash: current.row.requirements_hash,
        new_requirements_hash: requirementsHash,
        entry_candidates: analyzed.entryCandidates,
        dependency_files: analyzed.dependencyFiles,
        impacted_tasks: impact.impacted_tasks,
        missing_entry_tasks: impact.missing_entry_tasks,
        message: current.row.requirements_hash !== requirementsHash ? '项目已更新，检测到依赖变化，请重新安装运行环境。' : '项目已更新。',
      }
    } finally {
      await rm(updateRoot, { recursive: true, force: true }).catch(() => undefined)
      await rm(input.archivePath, { force: true }).catch(() => undefined)
    }
  }

  async rollback(projectId: string, confirmScheduleImpact = false): Promise<ProjectUpdateResult> {
    const current = await this.get(projectId)
    const releaseResult = await this.db.query<ReleaseRow>(
      `SELECT * FROM pr_project_releases WHERE project_id = $1 AND id <> $2 ORDER BY created_at DESC LIMIT 1`,
      [projectId, current.row.active_release_id],
    )
    const previous = releaseResult.rows[0]
    if (!previous) throw new Error('暂无可回滚版本。')
    if (!(await isDirectory(previous.root_path))) throw new Error('上一版本文件已不可用，无法回滚。')
    const previousMetadata = await this.readReleaseMetadata(previous.root_path)
    const impact = await this.findImpactedTasks(projectId, previousMetadata?.entry_candidates ?? [])
    if (impact.impacted_tasks.length > 0 && !confirmScheduleImpact) throw new ProjectImpactError(impact)
    await this.db.query('UPDATE pr_project_releases SET active = FALSE WHERE project_id = $1', [projectId])
    await this.db.query('UPDATE pr_project_releases SET active = TRUE WHERE id = $1', [previous.id])
    await this.db.query('UPDATE pr_projects SET active_release_id = $1, source_hash = $2, requirements_hash = $3, updated_at = NOW() WHERE id = $4', [previous.id, previous.source_hash, previous.requirements_hash, projectId])
    const metadata = previousMetadata ?? await this.analyzeReleaseMetadata(previous.root_path, current.metadata)
    metadata.source_hash = previous.source_hash
    metadata.requirements_hash = previous.requirements_hash
    metadata.last_backup_id = current.row.active_release_id
    await writeFile(path.join(this.projectRoot(projectId), 'project.json'), JSON.stringify(metadata, null, 2), 'utf8')
    await writeArchive(previous.root_path, path.join(this.projectRoot(projectId), 'archive.zip'))
    return { id: projectId, name: current.row.name, rolled_back: true, backup_id: previous.id, source_hash_changed: current.row.source_hash !== previous.source_hash, requirements_changed: current.row.requirements_hash !== previous.requirements_hash, old_requirements_hash: current.row.requirements_hash, new_requirements_hash: previous.requirements_hash, entry_candidates: metadata.entry_candidates, dependency_files: metadata.dependency_files, impacted_tasks: impact.impacted_tasks, missing_entry_tasks: impact.missing_entry_tasks, message: '项目已回滚。' }
  }

  sourceRoot(projectId: string): Promise<string> {
    return this.get(projectId).then((project) => project.sourceRoot)
  }

  async resolveSourcePath(projectId: string, relativePath: string): Promise<string> {
    const project = await this.get(projectId)
    return safePath(project.sourceRoot, relativePath)
  }

  async getMetadata(projectId: string): Promise<ProjectMetadata> {
    return (await this.get(projectId)).metadata
  }

  projectRoot(projectId: string): string {
    return path.join(config.dataDir, 'projects', projectId)
  }

  private async findImpactedTasks(projectId: string, entryCandidates: string[]): Promise<{ impacted_tasks: unknown[]; missing_entry_tasks: unknown[] }> {
    const schedules = await this.db.query<{ id: string; name: string; status: string; source: Record<string, unknown> }>("SELECT id, name, status, source FROM pr_scheduled_tasks WHERE source->>'project_id' = $1 OR source->>'upload_id' = $1", [projectId])
    const persistent = await this.db.query<{ id: string; name: string; status: string; source: Record<string, unknown> }>("SELECT id, name, status, source FROM pr_persistent_tasks WHERE source->>'project_id' = $1 OR source->>'upload_id' = $1", [projectId])
    const items = [...schedules.rows.map((row) => ({ id: row.id, name: row.name, type: 'schedule', status: row.status, entry_file: typeof row.source.entry_file === 'string' ? row.source.entry_file : null })), ...persistent.rows.map((row) => ({ id: row.id, name: row.name, type: 'persistent', status: row.status, entry_file: typeof row.source.entry_file === 'string' ? row.source.entry_file : null }))]
    const missing = items.filter((item) => item.entry_file !== null && !entryCandidates.includes(item.entry_file))
    return { impacted_tasks: items, missing_entry_tasks: missing }
  }

  private async toUpload(row: ProjectRow): Promise<ProjectUpload> {
    const metadata = await this.readMetadata(row.id)
    return {
      id: row.id,
      name: row.name,
      filename: metadata.filename,
      upload_source: metadata.upload_source,
      source_type: 'archive',
      file_count: metadata.file_count,
      total_size: metadata.total_size,
      entry_candidates: metadata.entry_candidates,
      python_files: metadata.python_files,
      dependency_files: metadata.dependency_files,
      file_tree: metadata.file_tree,
      status: row.status,
      error_message: metadata.error_message,
      created_at: asIso(row.created_at),
      updated_at: asIso(row.updated_at),
    }
  }

  private async readMetadata(projectId: string): Promise<ProjectMetadata> {
    try {
      return JSON.parse(await readFile(path.join(this.projectRoot(projectId), 'project.json'), 'utf8')) as ProjectMetadata
    } catch {
      return { filename: 'project.zip', upload_source: 'zip', file_count: 0, total_size: 0, entry_candidates: [], python_files: [], dependency_files: [], file_tree: [], source_hash: '', requirements_hash: null, update_count: 0, last_backup_id: null, error_message: null }
    }
  }

  private async readReleaseMetadata(sourceRoot: string): Promise<ProjectMetadata | null> {
    try {
      return JSON.parse(await readFile(path.join(path.dirname(sourceRoot), 'release.json'), 'utf8')) as ProjectMetadata
    } catch {
      return null
    }
  }

  private async analyzeReleaseMetadata(sourceRoot: string, fallback: ProjectMetadata): Promise<ProjectMetadata> {
    const analyzed = await analyzeSource(sourceRoot, await directorySize(sourceRoot))
    return { ...fallback, file_count: analyzed.fileCount, total_size: analyzed.totalSize, entry_candidates: analyzed.entryCandidates, python_files: analyzed.pythonFiles, dependency_files: analyzed.dependencyFiles, file_tree: analyzed.fileTree }
  }

  private async copyReleaseToBackup(projectId: string, releaseId: string, backupId: string): Promise<void> {
    const release = await this.db.query<ReleaseRow>('SELECT * FROM pr_project_releases WHERE id = $1 AND project_id = $2', [releaseId, projectId])
    const source = release.rows[0]?.root_path
    if (!source) return
    const destination = path.join(this.projectRoot(projectId), 'backups', backupId, 'source')
    await copyDirectory(source, destination)
  }

  private async pruneReleases(projectId: string, activeReleaseId: string): Promise<void> {
    const releases = await this.db.query<ReleaseRow>('SELECT * FROM pr_project_releases WHERE project_id = $1 ORDER BY created_at DESC', [projectId])
    for (const release of releases.rows.slice(BACKUP_RETENTION)) {
      if (release.id === activeReleaseId) continue
      await rm(path.dirname(release.root_path), { recursive: true, force: true }).catch(() => undefined)
      await this.db.query('DELETE FROM pr_project_releases WHERE id = $1', [release.id])
    }
  }
}

export interface ProjectRecord {
  row: ProjectRow
  metadata: ProjectMetadata
  sourceRoot: string
}

interface ProjectRow {
  id: string
  name: string
  status: string
  active_release_id: string | null
  source_hash: string | null
  requirements_hash: string | null
  created_at: Date | string
  updated_at: Date | string
  root_path: string | null
}

interface ReleaseRow {
  id: string
  root_path: string
  source_hash: string
  requirements_hash: string | null
}

async function extractArchive(bytes: Buffer, destination: string): Promise<AnalyzedSource> {
  let archive: AdmZip
  try {
    archive = new AdmZip(bytes)
  } catch {
    throw new Error('项目压缩包格式无效。')
  }
  const entries = archive.getEntries()
  if (entries.length === 0) throw new Error('项目压缩包为空。')
  if (entries.length > MAX_FILES) throw new Error(`项目文件数不能超过 ${MAX_FILES}。`)
  let totalSize = 0
  for (const entry of entries) {
    const relative = normalizeArchivePath(entry.entryName)
    if (entry.isDirectory) {
      await mkdir(path.join(destination, relative), { recursive: true })
      continue
    }
    const declaredSize = Number((entry.header as { size?: number }).size ?? 0)
    if (declaredSize > MAX_FILE_BYTES) throw new Error(`项目文件过大：${relative}`)
    const data = entry.getData()
    if (data.byteLength > MAX_FILE_BYTES) throw new Error(`项目文件过大：${relative}`)
    totalSize += data.byteLength
    if (totalSize > MAX_UNPACKED_BYTES) throw new Error('项目解压后体积超过 512 MiB。')
    const target = safePath(destination, relative)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, data, { flag: 'wx' })
  }
  const analyzed = await analyzeSource(destination, totalSize)
  if (analyzed.pythonFiles.length === 0) throw new Error('项目必须至少包含一个 .py 文件。')
  return analyzed
}

async function analyzeSource(sourceRoot: string, totalSize: number): Promise<AnalyzedSource> {
  const files: string[] = []
  const tree = await buildTree(sourceRoot, '', files)
  const pythonFiles = files.filter((file) => file.toLowerCase().endsWith('.py'))
  const dependencyFiles = files.filter((file) => ['requirements.txt', 'pyproject.toml', 'setup.py'].includes(path.basename(file).toLowerCase()))
  const preferred = ['main.py', 'app.py', 'run.py', '__main__.py']
  const entryCandidates = [...preferred.filter((name) => files.includes(name)), ...pythonFiles.filter((name) => !preferred.includes(name)).slice(0, 100)]
  return { fileCount: files.length, totalSize, pythonFiles, dependencyFiles, entryCandidates, fileTree: tree }
}

interface AnalyzedSource {
  fileCount: number
  totalSize: number
  pythonFiles: string[]
  dependencyFiles: string[]
  entryCandidates: string[]
  fileTree: ProjectFileNode[]
}

async function buildTree(root: string, relative: string, files: string[], depth = 0): Promise<ProjectFileNode[]> {
  if (depth > 32) throw new Error('项目目录层级过深。')
  const entries = await readdir(path.join(root, relative), { withFileTypes: true })
  const nodes: ProjectFileNode[] = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '__pycache__' || entry.name === '.git') continue
    const childPath = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      nodes.push({ name: entry.name, path: childPath, type: 'directory', children: await buildTree(root, childPath, files, depth + 1) })
    } else if (entry.isFile()) {
      files.push(childPath)
      if (files.length > MAX_TREE_NODES) throw new Error(`项目文件数不能超过 ${MAX_TREE_NODES}。`)
      nodes.push({ name: entry.name, path: childPath, type: 'file' })
    }
  }
  return nodes
}

async function hashDirectory(root: string): Promise<string> {
  const files: string[] = []
  await collectFiles(root, '', files)
  const digest = createHash('sha256')
  for (const relative of files.sort()) {
    digest.update(relative)
    digest.update('\0')
    digest.update(await readFile(path.join(root, relative)))
    digest.update('\0')
  }
  return digest.digest('hex')
}

async function collectFiles(root: string, relative: string, output: string[]): Promise<void> {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === '__pycache__' || entry.name === '.git') continue
    const child = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isDirectory()) await collectFiles(root, child, output)
    else if (entry.isFile()) output.push(child)
  }
}

async function requirementsHashFor(root: string, dependencyFiles: string[]): Promise<string | null> {
  const requirements = dependencyFiles.filter((file) => path.basename(file).toLowerCase() === 'requirements.txt').sort()
  if (requirements.length === 0) return null
  const digest = createHash('sha256')
  for (const relative of requirements) {
    digest.update(relative)
    digest.update(await readFile(safePath(root, relative)))
  }
  return digest.digest('hex')
}

async function directorySize(root: string): Promise<number> {
  const entries = await readdir(root, { withFileTypes: true })
  let total = 0
  for (const entry of entries) {
    const child = path.join(root, entry.name)
    if (entry.isDirectory()) total += await directorySize(child)
    else if (entry.isFile()) total += (await stat(child)).size
  }
  return total
}

async function writeArchive(sourceRoot: string, archivePath: string): Promise<void> {
  const archive = new AdmZip()
  archive.addLocalFolder(sourceRoot)
  await writeFile(archivePath, archive.toBuffer())
}

function normalizeArchivePath(input: string): string {
  const normalized = input.replaceAll('\\', '/').replace(/\/+$/, '')
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.includes('\0')) throw new Error('压缩包包含非法路径。')
  const parts = normalized.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new Error('压缩包包含路径穿越条目。')
  return parts.join('/')
}

function safePath(root: string, relative: string): string {
  const normalized = normalizeArchivePath(relative)
  const candidate = path.resolve(root, normalized)
  const rootPath = path.resolve(root)
  if (!candidate.startsWith(`${rootPath}${path.sep}`)) throw new Error('路径超出项目目录。')
  return candidate
}

async function copyDirectory(source: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true })
  const entries = await readdir(source, { withFileTypes: true })
  for (const entry of entries) {
    const from = path.join(source, entry.name)
    const to = path.join(destination, entry.name)
    if (entry.isDirectory()) await copyDirectory(from, to)
    else if (entry.isFile()) await writeFile(to, await readFile(from), { flag: 'wx' })
  }
}

async function isDirectory(target: string): Promise<boolean> {
  return stat(target).then((value) => value.isDirectory()).catch(() => false)
}

async function moveDirectory(source: string, destination: string): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true })
  const { rename } = await import('node:fs/promises')
  await rename(source, destination)
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}
