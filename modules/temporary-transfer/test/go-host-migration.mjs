import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'

// Run only against a new disposable ToolNest instance with a private database and module data directory.
const [host, nodePackage, goPackage, mode] = process.argv.slice(2)
const origin = new URL(host)
assert.equal(origin.protocol, 'http:')
assert.equal(origin.hostname, '127.0.0.1')
assert.equal(origin.pathname, '/')
assert.ok(origin.port && nodePackage && goPackage, 'Provide host, Node package (or --native-only) and Go package')
const base = '/api/v1'
const modulePath = base + '/modules/temporary-transfer'
let cookie

async function request(path, method = 'GET', body, { guest = false, headers: extra = {} } = {}) {
  const headers = { ...extra }
  if (!guest && cookie) headers.cookie = cookie
  if (body !== undefined && !(body instanceof FormData) && !Buffer.isBuffer(body)) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(body)
  }
  return fetch(new URL(path, origin), { method, headers, body, redirect: 'error', signal: AbortSignal.timeout(180_000) })
}

async function json(path, method = 'GET', body, { status = 200, guest = false } = {}) {
  const response = await request(path, method, body, { guest })
  const data = await response.json()
  assert.equal(response.status, status, path + ' ' + JSON.stringify(data))
  return data.data ?? data
}

async function waitOperation(queued) {
  const id = queued.id ?? queued.operation_id
  assert.ok(id, 'operation id missing')
  for (let i = 0; i < 90; i += 1) {
    const operation = await json(modulePath + '/operations/' + id)
    if (operation.status === 'failed') throw new Error(operation.error ?? operation.message)
    if (operation.status === 'completed') return operation
    await sleep(300)
  }
  throw new Error('operation timed out')
}

async function install(path, pkg) {
  const upload = new FormData()
  upload.set('file', new Blob([await readFile(pkg)]), 'module.tnmod')
  return waitOperation(await json(path, 'POST', upload, { status: 202 }))
}

const password = randomBytes(32).toString('base64url')
await json(base + '/system/initialize', 'POST', {
  system_name: 'File Post Migration Test', username: 'migration-test', password, confirm_password: password,
}, { status: 201 })
const login = await request(base + '/auth/login', 'POST', { username: 'migration-test', password })
assert.ok(login.ok, 'isolated host login failed')
cookie = login.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ')
assert.ok(cookie, 'session cookie missing')
await json(base + '/auth/me')
async function control(action) {
  const response = await request(modulePath + '/' + action, 'POST', {})
  const data = await response.json()
  assert.ok(response.ok, JSON.stringify(data))
  const result = data.data ?? data
  if (result.status === 'queued' || result.status === 'running') await waitOperation(result)
}

async function installAndEnable(pkg) {
  const installed = await install(base + '/modules/install', pkg)
  if ((await json(modulePath)).status !== 'enabled') await control('enable')
  return installed
}

if (nodePackage === '--native-only') {
  await installAndEnable(goPackage)
  assert.equal((await json(modulePath)).manifest.runtime.kind, 'native')
  assert.equal((await json(modulePath + '/transfer-settings')).storageBackend, 'local')
  await control('disable')
  assert.equal((await json(modulePath)).status, 'disabled')
  await control('enable')
  assert.equal((await json(modulePath + '/transfer-settings')).canManageSettings, true)
  console.log('Native install, authenticated readiness, graceful disable and re-enable passed')
  process.exit(0)
}

const installed = await installAndEnable(nodePackage)
const nodeRelease = installed.releaseId ?? installed.release_id
assert.ok(nodeRelease)
assert.equal((await json(modulePath + '/transfer-settings')).storageBackend, 'local')

const prefix = modulePath + '/transfers'
const payload = Buffer.alloc(5 * 1024 * 1024 + 12, 29)
const fileTransfer = await json(prefix, 'POST', {
  kind: 'files', title: '跨版本续传', durationMinutes: 60, maxGrants: 2,
}, { status: 201 })
const fileID = randomUUID()
const filePrefix = prefix + '/' + fileTransfer.id + '/files/' + fileID
const file = await json(prefix + '/' + fileTransfer.id + '/files', 'POST', {
  clientId: fileID, filename: '续传测试.bin', size: payload.length,
}, { status: 201 })
assert.equal(file.partCount, 2)

async function putPart(path, bytes) {
  const response = await request(path, 'PUT', bytes, { guest: true, headers: { 'content-type': 'application/octet-stream' } })
  assert.equal(response.status, 204, (await response.text()).slice(0, 300))
  assert.ok(response.headers.get('etag'))
}

const firstPart = await json(filePrefix + '/parts/1', 'POST', {})
const secondPart = await json(filePrefix + '/parts/2', 'POST', {})
await putPart(firstPart.url, payload.subarray(0, file.partSize))
const text = await json(prefix, 'POST', { kind: 'text', title: 'Node 文本', content: '旧链接仍可访问' }, { status: 201 })
const oldVerify = modulePath + '/public/' + text.id + '/verify'

if (mode === '--legacy-windows') {
  // Windows cannot deliver SIGTERM to the old Node release. The host waits for
  // requests to drain, then forcibly stops the process and reports the timeout.
  try {
    await control('disable')
  } catch (error) {
    assert.match(String(error), /module did not stop (?:gracefully|cleanly)/)
    await control('disable')
  }
}
await install(modulePath + '/upgrade', goPackage)
if (mode === '--legacy-windows') await control('enable')
assert.equal((await json(modulePath)).manifest.runtime.kind, 'native')
assert.equal((await json(oldVerify, 'POST', { code: text.code }, { guest: true })).content, '旧链接仍可访问')
assert.equal((await json(modulePath + '/pickup', 'POST', { code: text.pickupCode })).id, text.id)
const existing = await json(filePrefix + '/parts')
assert.equal(existing.parts.length, 1)
assert.equal(existing.parts[0].Size, file.partSize)
await putPart(secondPart.url, payload.subarray(file.partSize))
await json(filePrefix + '/complete', 'POST', {})
await json(prefix + '/' + fileTransfer.id + '/publish', 'POST', {})
const guestAsset = await request(modulePath + '/public/assets/guest.js', 'GET', undefined, { guest: true })
assert.equal(guestAsset.status, 200)
assert.match(guestAsset.headers.get('content-type'), /javascript/)
await guestAsset.body.cancel()

const goGrant = await json(filePrefix + '/download', 'POST', {})
const partial = await request(goGrant.url, 'GET', undefined, { guest: true, headers: { range: 'bytes=2-13' } })
assert.equal(partial.status, 206)
assert.deepEqual(Buffer.from(await partial.arrayBuffer()), payload.subarray(2, 14))
const goText = await json(prefix, 'POST', { kind: 'text', title: 'Go 文本', content: '回退后可读' }, { status: 201 })

await waitOperation(await json(modulePath + '/rollback', 'POST', { release_id: nodeRelease }, { status: 202 }))
assert.equal((await json(modulePath)).manifest.runtime.kind, 'node')
assert.equal((await json(modulePath + '/public/' + goText.id + '/verify', 'POST', { code: goText.code }, { guest: true })).content, '回退后可读')
assert.equal((await json(modulePath + '/pickup', 'POST', { code: goText.pickupCode })).id, goText.id)
const final = await request(goGrant.url, 'GET', undefined, { guest: true })
assert.equal(final.status, 200)
assert.deepEqual(Buffer.from(await final.arrayBuffer()), payload)
console.log('Node → Go → Node passed: old codes, old signed uploads, resumed upload, Range, guest assets, Go codes and signed download')
