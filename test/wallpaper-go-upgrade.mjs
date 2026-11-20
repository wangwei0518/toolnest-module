import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const [nodePackage, goPackage] = process.argv.slice(2)
assert.ok(nodePackage && goPackage, 'Provide the Node and Go .tnmod packages')
const image = process.env.TOOLNEST_GO_TEST_IMAGE || 'toolnest-distribution:local'
const name = 'toolnest-wallpaper-contract-' + randomUUID().slice(0, 8)
const id = 'xiaomi-rear-wallpaper'
const username = 'contract-admin'
const password = 'contract-' + randomUUID()
let origin
let cookie

function docker(...args) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

async function wait(check, label, timeout = 90_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return
    await delay(350)
  }
  throw new Error('Timed out waiting for ' + label)
}

async function api(path, { method = 'GET', body, code = 200 } = {}) {
  const payload = body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body)
  const headers = {}
  if (cookie) headers.cookie = cookie
  if (typeof payload === 'string') headers['content-type'] = 'application/json'
  const response = await fetch(origin + '/api/v1' + path, { method, body: payload, headers, signal: AbortSignal.timeout(30_000) })
  const result = await response.json()
  assert.equal(response.status, code, method + ' ' + path + ': ' + JSON.stringify(result))
  return { result, response }
}

async function operation(path, body) {
  const { result } = await api(path, { method: 'POST', body, code: 202 })
  assert.ok(result.id)
  let done
  await wait(async () => {
    const { result: { data } } = await api('/modules/' + id + '/operations/' + result.id)
    assert.notEqual(data.status, 'failed', JSON.stringify(data))
    done = data
    return data.status === 'completed'
  }, path)
  assert.equal(done.moduleId, id)
  return done
}

async function upload(path, file) {
  const form = new FormData()
  form.set('file', new Blob([await readFile(file)], { type: 'application/zip' }), basename(file))
  return operation(path, form)
}

const root = '/modules/' + id
async function readRoute(path, options) {
  return (await api(root + path, options)).result
}

async function asset(path, mime, disposition) {
  const response = await fetch(origin + '/api/v1' + root + path, {
    headers: { cookie }, signal: AbortSignal.timeout(30_000),
  })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), mime)
  assert.match(response.headers.get('content-disposition'), disposition)
  const bytes = Buffer.from(await response.arrayBuffer())
  assert.equal(Number(response.headers.get('x-toolnest-asset-size')), bytes.length)
  return bytes
}

async function waitForJob(jobId) {
  await wait(async () => {
    const job = await readRoute('/jobs/' + jobId)
    assert.notEqual(job.state, 'failed', JSON.stringify(job))
    return job.state === 'completed'
  }, 'wallpaper generation')
}

try {
  docker('run', '--detach', '--rm', '--name', name, '--publish', '127.0.0.1::8000',
    '--env', 'DATABASE_BACKUP_SCHEDULE=off',
    ...(process.env.TOOLNEST_GO_TEST_BINARY ? ['--mount', 'type=bind,source=' + process.env.TOOLNEST_GO_TEST_BINARY + ',target=/app/backend/toolnest-platform,readonly'] : []),
    image)
  origin = 'http://' + docker('port', name, '8000/tcp').split('\n')[0]
  await wait(async () => {
    try {
      return (await fetch(origin + '/api/v1/system/health', { signal: AbortSignal.timeout(1000) })).ok
    } catch {
      return false
    }
  }, 'host readiness')
  await api('/system/initialize', {
    method: 'POST', code: 201, body: { username, password, confirm_password: password, system_name: 'Wallpaper migration test' },
  })
  const login = await api('/auth/login', { method: 'POST', code: 201, body: { username, password } })
  cookie = login.response.headers.get('set-cookie').split(';')[0]
  const previous = await upload('/modules/install', nodePackage)

  await api(root + '/enable', { method: 'POST', code: 201 })
  const fixture = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAUCAIAAABj86gYAAAAIElEQVR4nGNQSFtFU8QwasGoBaMWjFowasGoBaMWEIMAB0X4H/xTkV4AAAAASUVORK5CYII=', 'base64')
  const form = new FormData()
  form.set('file', new Blob([fixture], { type: 'image/png' }), '旧作品.png')
  const { wallpaper, job } = await readRoute('/wallpapers', { method: 'POST', body: form })
  await waitForJob(job.id)
  const path = '/wallpapers/' + wallpaper.id
  const before = await readRoute(path)
  const preview = await asset(path + '/preview', 'image/webp', /^inline/)
  const exportImage = await asset(path + '/export', 'image/png', /^attachment/)
  assert.deepEqual(await asset(path + '/source', 'image/png', /filename\*=UTF-8''/i), fixture)

  const upgraded = await upload(root + '/upgrade', goPackage)
  assert.notEqual(previous.releaseId, upgraded.releaseId)
  assert.deepEqual(await readRoute(path), before)
  assert.deepEqual(await asset(path + '/preview', 'image/webp', /^inline/), preview)
  assert.deepEqual(await asset(path + '/export', 'image/png', /^attachment/), exportImage)
  const crop = { left: 0.25, top: 0.25, width: before.crop.width / 2, height: before.crop.height / 2 }
  const updated = await readRoute(path + '/crop', { method: 'PUT', body: crop })
  await waitForJob(updated.job.id)
  assert.deepEqual((await readRoute(path)).crop, crop)
  const goExport = await asset(path + '/export', 'image/png', /^attachment/)
  assert.equal(goExport.readUInt32BE(16), 976)
  assert.equal(goExport.readUInt32BE(20), 596)

  await operation(root + '/rollback', { release_id: previous.releaseId })
  assert.deepEqual((await readRoute(path)).crop, crop)
  assert.deepEqual(await asset(path + '/export', 'image/png', /^attachment/), goExport)
  console.log('Node → Go → Node：安装、原地升级、旧作品读写、文件进度响应头和回滚通过')
} catch (error) {
  try { console.error(docker('logs', '--tail', '60', name)) } catch {}
  throw error
} finally {
  try { docker('stop', '-t', '20', name) } catch {}
}
