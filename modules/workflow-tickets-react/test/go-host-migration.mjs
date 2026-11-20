import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'

const [nodePackage, goPackage] = process.argv.slice(2)
assert.ok(nodePackage && goPackage, 'Pass a published Node package and the linux/amd64 Go package.')
const name = 'toolnest-workflow-migration-' + randomUUID().slice(0, 8)
const databaseName = name + '-db'
const image = process.env.TOOLNEST_TEST_IMAGE || 'wudaren/toolnest:latest'
const base = '/api/v1'
const modulePath = base + '/modules/workflow-tickets-react'
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 120_000 }).trim()
let origin, cookie, started, networkCreated, databaseStarted

function refreshOrigin() {
  origin = 'http://' + docker('port', name, '8000/tcp').split('\n')[0]
}

async function request(path, method = 'GET', body, guest = false) {
  const headers = {}
  if (!guest && cookie) headers.cookie = cookie
  if (body !== undefined && !(body instanceof FormData)) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(body)
  }
  return fetch(new URL(path, origin), {
    method, headers, body, redirect: 'error', signal: AbortSignal.timeout(30_000),
  })
}

async function json(path, method = 'GET', body, expected = 200) {
  const response = await request(path, method, body)
  const data = await response.json()
  assert.equal(response.status, expected, path + ' ' + JSON.stringify(data))
  return data.data ?? data
}

async function until(check, label) {
  for (let i = 0; i < 180; i++) {
    const value = await check()
    if (value) return value
    await sleep(500)
  }
  throw new Error('Timed out waiting for ' + label)
}

async function health() {
  await until(async () => {
    try {
      return (await fetch(origin + base + '/system/health', { signal: AbortSignal.timeout(1500) })).ok
    } catch {
      return false
    }
  }, 'platform readiness')
}

async function operation(queued) {
  assert.ok(queued.id, 'operation ID missing')
  return until(async () => {
    const result = await json(modulePath + '/operations/' + queued.id)
    assert.notEqual(result.status, 'failed', result.error ?? JSON.stringify(result))
    return result.status === 'completed' && result
  }, 'module operation')
}

async function install(path, file) {
  const body = new FormData()
  body.set('file', new Blob([await readFile(file)]), 'workflow.tnmod')
  return operation(await json(path, 'POST', body, 202))
}

try {
  const dbPassword = randomUUID()
  docker('network', 'create', name)
  networkCreated = true
  docker('run', '-d', '--name', databaseName, '--network', name, '-e', 'POSTGRES_PASSWORD=' + dbPassword, 'postgres:16-alpine')
  databaseStarted = true
  await until(async () => {
    try {
      docker('exec', databaseName, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres')
      return true
    } catch {
      return false
    }
  }, 'isolated PostgreSQL')
  const databaseURL = 'postgres://postgres:' + dbPassword + '@' + databaseName + ':5432/postgres?sslmode=disable'
  docker('run', '-d', '--name', name, '--network', name, '-p', '127.0.0.1::8000',
    '-e', 'DATABASE_MODE=external', '-e', 'DATABASE_URL=' + databaseURL, '-e', 'DATABASE_BACKUP_SCHEDULE=off', image)
  started = true
  refreshOrigin()
  await health()
  assert.equal((await json(base + '/system/initialization')).initialized, false)
  const username = 'migration-test'
  const password = 'fixture-' + randomUUID()
  await json(base + '/system/initialize', 'POST', {
    system_name: 'Workflow Go Migration Test', username, password, confirm_password: password,
  }, 201)
  const login = await request(base + '/auth/login', 'POST', { username, password })
  assert.ok(login.ok)
  cookie = login.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ')
  assert.ok(cookie)

  const oldRelease = await install(base + '/modules/install', nodePackage)
  assert.ok(oldRelease.releaseId)
  if ((await json(modulePath)).status !== 'enabled') {
    await json(modulePath + '/enabled', 'PUT', { enabled: true })
  }
  assert.equal((await json(modulePath)).manifest.runtime.kind, 'node')
  const workflow = await json(modulePath + '/workflows', 'POST', { name: '历史工单模板' })
  const nodeID = workflow.versions[0].nodes[0].id
  const workflowPath = modulePath + '/workflows/' + workflow.id
  await json(workflowPath, 'PUT', {
    nodes: [{ id: nodeID, name: '留档', key: 'archive', form_schema: { fields: [
      { id: 'proof', type: 'image', label: '凭证', config: { max_size_mb: 1 } },
    ] } }],
    edges: [],
  })
  await json(workflowPath + '/publish', 'POST', {})
  const oldTicket = await json(modulePath + '/tickets', 'POST', { workflow_id: workflow.id, title: 'Node 工单' })
  const uploaded = new FormData()
  uploaded.set('field_id', 'proof')
  const proof = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)
  uploaded.set('file', new Blob([proof], { type: 'image/png' }), 'proof.png')
  const attachment = await json(modulePath + '/tickets/' + oldTicket.id + '/nodes/' + nodeID + '/attachments', 'POST', uploaded)
  async function readProof() {
    const response = await request(attachment.url)
    assert.equal(response.status, 200)
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), proof)
  }
  await readProof()
  await json(modulePath + '/module-settings', 'PUT', { max_file_size_mb: 24 })
  const today = new Date(Date.now() + 40_000)
  const schedule = await json(workflowPath + '/schedules', 'POST', {
    name: '换版后到期', schedule_type: 'once', start_at: today.toISOString(),
  })
  const schedules = workflowPath + '/schedules/' + schedule.id

  await install(modulePath + '/upgrade', goPackage)
  assert.equal((await json(modulePath)).manifest.runtime.kind, 'native')
  assert.equal((await json(modulePath + '/module-settings')).max_file_size_mb, 24)
  assert.equal((await json(modulePath + '/tickets/' + oldTicket.id)).title, 'Node 工单')
  await readProof()
  const completed = await json(modulePath + '/tickets/' + oldTicket.id + '/nodes/' + nodeID + '/complete', 'POST', {})
  assert.equal(completed.status, 'completed')
  const goTicket = await json(modulePath + '/tickets', 'POST', { workflow_id: workflow.id, title: 'Go 工单' })
  assert.equal((await json(workflowPath + '/schedules'))[0].next_run_at, today.toISOString())

  // No request goes to the module after this restart until after the scheduler's next tick.
  docker('stop', '--time', '80', name)
  docker('start', name)
  refreshOrigin()
  await health()
  await sleep(Math.max(0, today.getTime() - Date.now()) + 35_000)
  const firstModuleRequest = Date.now()
  const runs = await json(schedules + '/runs')
  assert.equal(runs.length, 1)
  assert.equal(runs[0].status, 'succeeded')
  assert.equal(runs[0].planned_at, today.toISOString())
  assert.ok(Date.parse(runs[0].executed_at) < firstModuleRequest - 1000, 'Schedule executed only after a module request')
  const backgroundID = runs[0].ticket_id
  assert.ok(backgroundID)

  await json(modulePath + '/enabled', 'PUT', { enabled: false })
  await json(modulePath + '/enabled', 'PUT', { enabled: true })
  assert.equal((await json(schedules + '/runs')).length, 1)
  await operation(await json(modulePath + '/rollback', 'POST', { release_id: oldRelease.releaseId }, 202))
  assert.equal((await json(modulePath)).manifest.runtime.kind, 'node')
  assert.equal((await json(modulePath + '/tickets/' + goTicket.id)).title, 'Go 工单')
  assert.equal((await json(modulePath + '/tickets/' + oldTicket.id)).status, 'completed')
  assert.equal((await json(modulePath + '/tickets/' + backgroundID)).created_by, '系统 · 定时任务')
  assert.equal((await json(schedules + '/runs')).length, 1)
  await readProof()
  console.log('Node → Go → Node passed: workflow, tickets, settings, attachment, scheduled run without module requests, and graceful Go stop')
} catch (error) {
  if (started) {
    try { console.error(docker('logs', '--tail', '45', name)) } catch { /* preserve the original error */ }
  }
  throw error
} finally {
  try {
    if (started) docker('rm', '-f', '-v', name)
  } finally {
    try {
      if (databaseStarted) docker('rm', '-f', '-v', databaseName)
    } finally {
      if (networkCreated) docker('network', 'rm', name)
    }
  }
}
