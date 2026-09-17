import AdmZip from 'adm-zip'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const token = 'integration-test-token'
const boundary = '----toolnest-python-runner-integration'
let context: Awaited<ReturnType<(typeof import('../src/main.ts'))['createApp']>>
let dataDir = ''
let logDir = ''
let projectId = ''
let scheduleId = ''
let persistentId = ''

function authHeaders(extra: Record<string, string> = {}): Record<string, string> { return { 'x-toolnest-internal-token': token, ...extra } }

function archiveBuffer(version: number): Buffer {
  const archive = new AdmZip()
  archive.addFile('main.py', Buffer.from(`print("integration-${version}")\n`, 'utf8'))
  archive.addFile('config.json', Buffer.from(JSON.stringify({ api_key: 'secret-value', version }), 'utf8'))
  archive.addFile('requirements.txt', Buffer.from('requests==2.32.0\n', 'utf8'))
  if (version === 1) archive.addFile('.env', Buffer.from('PRIVATE_TOKEN=must-not-preview\n', 'utf8'))
  return archive.toBuffer()
}

function multipart(file: Buffer, filename: string, fields: Record<string, string>): { payload: Buffer; contentType: string } {
  const chunks: Buffer[] = []
  for (const [name, value] of Object.entries(fields)) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, 'utf8'))
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/zip\r\n\r\n`, 'utf8'), file, Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'))
  return { payload: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` }
}

async function request(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown, headers: Record<string, string> = authHeaders()) {
  const response = await context.app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload: typeof payload === 'string' || Buffer.isBuffer(payload) ? payload : JSON.stringify(payload) }) })
  return { response, body: response.body ? JSON.parse(response.body) as Record<string, any> : null }
}

describe.sequential('Python Runner React module integration', () => {
  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'toolnest-python-runner-data-'))
    logDir = await mkdtemp(path.join(os.tmpdir(), 'toolnest-python-runner-log-'))
    process.env.NODE_ENV = 'test'
    process.env.VITEST = 'true'
    process.env.TOOLNEST_PLUGIN_ID = 'python-runner'
    process.env.TOOLNEST_PLUGIN_RELEASE_ID = 'integration'
    process.env.TOOLNEST_PLUGIN_PORT = '0'
    process.env.TOOLNEST_PLUGIN_TOKEN = token
    process.env.TOOLNEST_PLUGIN_DATA_DIR = dataDir
    process.env.TOOLNEST_PLUGIN_LOG_DIR = logDir
    process.env.TOOLNEST_PLUGIN_DATABASE_URL = process.env.TEST_TOOLNEST_PLUGIN_DATABASE_URL ?? 'postgresql://toolnest:toolnest@127.0.0.1:5432/toolnest_react'
    process.env.PYTHON_EXECUTABLE = process.env.TEST_PYTHON_EXECUTABLE ?? 'python'
    const module = await import('../src/main.ts')
    context = await module.createApp()
  })

  afterAll(async () => {
    if (persistentId) await context.db.query('DELETE FROM pr_persistent_tasks WHERE id = $1', [persistentId])
    if (scheduleId) await context.db.query('DELETE FROM pr_scheduled_tasks WHERE id = $1', [scheduleId])
    if (projectId) await context.db.query('DELETE FROM pr_projects WHERE id = $1', [projectId])
    await context.app.close()
    await rm(dataDir, { recursive: true, force: true })
    await rm(logDir, { recursive: true, force: true })
  })

  it('enforces module authentication and exposes readiness', async () => {
    const unauthorized = await request('GET', '/health/ready', undefined, {})
    expect(unauthorized.response.statusCode).toBe(401)
    const ready = await request('GET', '/health/ready')
    expect(ready.response.statusCode).toBe(200)
    expect(ready.body.ready).toBe(true)
  })

  it('scans inline code and requires a matching security confirmation', async () => {
    const scan = await request('POST', '/security/scan-inline', { code: 'import subprocess\nprint("unsafe")' }, authHeaders({ 'content-type': 'application/json' }))
    expect(scan.response.statusCode).toBe(200)
    expect(scan.body.risk_level).toBe('high')
    const blocked = await request('POST', '/executions', { name: 'blocked-inline', source: { type: 'inline', code: 'import subprocess\nprint("blocked")' }, args: [], timeout_seconds: 10, runtime_environment: 'system' }, authHeaders({ 'content-type': 'application/json' }))
    expect(blocked.response.statusCode).toBe(409)
    expect(blocked.body.data.security.scan_id).toBeTruthy()
    const confirmed = await request('POST', '/executions', { name: 'confirmed-inline', source: { type: 'inline', code: 'import subprocess\nprint("confirmed")' }, args: [], timeout_seconds: 10, runtime_environment: 'system', security: { risk_confirmed: true, scan_id: scan.body.scan_id } }, authHeaders({ 'content-type': 'application/json' }))
    expect(confirmed.response.statusCode).toBe(200)
    expect(confirmed.body.status).toBe('success')
    expect(confirmed.body.stdout).toContain('confirmed')
  })

  it('uploads, previews, updates, rolls back, and executes a project', async () => {
    const uploadBody = multipart(archiveBuffer(1), 'integration-project.zip', { name: 'Integration Project', upload_source: 'zip' })
    const upload = await request('POST', '/uploads/archive', uploadBody.payload, authHeaders({ 'content-type': uploadBody.contentType }))
    expect(upload.response.statusCode).toBe(200)
    projectId = upload.body.id
    expect(upload.body.entry_candidates).toContain('main.py')
    expect(upload.body.dependency_files).toContain('requirements.txt')

    const security = await request('GET', `/uploads/${projectId}/security`)
    expect(security.body.risk_level).toBe('high')
    const preview = await request('GET', `/uploads/${projectId}/files/preview?path=config.json&scope=source`)
    expect(preview.response.statusCode).toBe(200)
    expect(preview.body.content).toContain('secret-value')
    const sensitivePreview = await request('GET', `/uploads/${projectId}/files/preview?path=.env&scope=source`)
    expect(sensitivePreview.response.statusCode).toBe(403)

    const config = await request('GET', `/uploads/${projectId}/config`)
    expect(config.response.statusCode).toBe(200)
    expect(config.body.content).not.toContain('secret-value')
    expect(config.body.content).toContain('********')
    const savedConfig = await request('PUT', `/uploads/${projectId}/config`, { content: config.body.content }, authHeaders({ 'content-type': 'application/json' }))
    expect(savedConfig.response.statusCode).toBe(200)
    const restoredConfig = await request('GET', `/uploads/${projectId}/config`)
    expect(restoredConfig.body.values.api_key).toBe('********')

    const execution = await request('POST', '/executions', { name: 'project-execution', source: { type: 'archive', project_id: projectId, entry_file: 'main.py' }, args: [], timeout_seconds: 10, runtime_environment: 'system', security: { risk_confirmed: true, scan_id: security.body.scan_id } }, authHeaders({ 'content-type': 'application/json' }))
    expect(execution.response.statusCode).toBe(200)
    expect(execution.body.stdout).toContain('integration-1')

    const updateBody = multipart(archiveBuffer(2), 'integration-project-v2.zip', { name: 'Integration Project v2', upload_source: 'zip' })
    const update = await request('POST', `/uploads/${projectId}/update`, updateBody.payload, authHeaders({ 'content-type': updateBody.contentType }))
    expect(update.response.statusCode).toBe(200)
    expect(update.body.updated).toBe(true)
    expect(update.body.backup_id).toBeTruthy()
    const current = await request('GET', `/uploads/${projectId}`)
    expect(current.body.filename).toBe('integration-project-v2.zip')
    const rollback = await request('POST', `/uploads/${projectId}/rollback`, {}, authHeaders({ 'content-type': 'application/json' }))
    expect(rollback.response.statusCode).toBe(200)
    expect(rollback.body.rolled_back).toBe(true)
    const rolledBack = await request('GET', `/uploads/${projectId}`)
    expect(rolledBack.body.filename).toBe('integration-project.zip')
  })

  it('calculates storage, schedules by timezone, and persists task definitions', async () => {
    const security = await request('GET', `/uploads/${projectId}/security`)
    const storage = await request('GET', `/uploads/${projectId}/storage`)
    expect(storage.response.statusCode).toBe(200)
    expect(storage.body.total_size).toBeGreaterThanOrEqual(storage.body.source_size)
    expect(storage.body.backup_count).toBeGreaterThan(0)

    const schedule = await request('POST', '/scheduled-tasks', { name: 'Integration schedule', source: { type: 'archive', project_id: projectId, entry_file: 'main.py' }, security: { risk_confirmed: true, scan_id: security.body.scan_id }, schedule_type: 'cron', cron_expression: '*/5 * * * *', timezone: 'Asia/Shanghai', enabled: false, args: [], timeout_seconds: 10 }, authHeaders({ 'content-type': 'application/json' }))
    expect(schedule.response.statusCode).toBe(200)
    scheduleId = schedule.body.id
    expect(schedule.body.timezone).toBe('Asia/Shanghai')
    expect(schedule.body.next_run_at).toBeNull()
    const enabled = await request('POST', `/scheduled-tasks/${scheduleId}/enable`)
    expect(enabled.response.statusCode).toBe(200)
    expect(enabled.body.next_run_at).toBeTruthy()

    const persistent = await request('POST', '/persistent-tasks', { name: 'Integration persistent', source: { type: 'archive', project_id: projectId, entry_file: 'main.py' }, security: { risk_confirmed: true, scan_id: security.body.scan_id }, runtime_environment: 'system', auto_start: false, restart_policy: 'never' }, authHeaders({ 'content-type': 'application/json' }))
    expect(persistent.response.statusCode).toBe(200)
    persistentId = persistent.body.id
    const persistentGet = await request('GET', `/persistent-tasks/${persistentId}`)
    expect(persistentGet.body.status).toBe('stopped')

    const impactUpdateBody = multipart(archiveBuffer(2), 'integration-project-impact.zip', { name: 'Integration Project impact', upload_source: 'zip' })
    const blockedUpdate = await request('POST', `/uploads/${projectId}/update`, impactUpdateBody.payload, authHeaders({ 'content-type': impactUpdateBody.contentType }))
    expect(blockedUpdate.response.statusCode).toBe(409)
    expect(blockedUpdate.body.data.impact.impacted_tasks.length).toBeGreaterThanOrEqual(2)
    const confirmedUpdateBody = multipart(archiveBuffer(2), 'integration-project-impact.zip', { name: 'Integration Project impact', upload_source: 'zip', confirm_schedule_impact: 'true' })
    const confirmedUpdate = await request('POST', `/uploads/${projectId}/update`, confirmedUpdateBody.payload, authHeaders({ 'content-type': confirmedUpdateBody.contentType }))
    expect(confirmedUpdate.response.statusCode).toBe(200)
    expect(confirmedUpdate.body.updated).toBe(true)
  })
})
