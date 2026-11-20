import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import AdmZip from 'adm-zip'

const root = process.argv[2] || 'release-assets'
const packages = (await readdir(root)).filter(name => name.endsWith('.tnmod')).sort()
if (!packages.length) process.exit(0)
const container = 'toolnest-module-release-' + randomUUID().slice(0, 8)
const image = process.env.TOOLNEST_TEST_IMAGE || 'wudaren/toolnest:latest'
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 180_000 }).trim()
let origin = process.env.TOOLNEST_TEST_ORIGIN, cookie, started

async function until(fn, label) {
  for (let i = 0; i < 180; i++) {
    const result = await fn()
    if (result) return result
    await delay(500)
  }
  throw Error(`Timed out waiting for ${label}`)
}

async function api(endpoint, method = 'GET', body, expected = 200) {
  const json = body !== undefined && !(body instanceof FormData)
  const response = await fetch(origin + '/api/v1' + endpoint, {
    method, body: json ? JSON.stringify(body) : body,
    headers: { ...(cookie ? { cookie } : {}), ...(json ? { 'content-type': 'application/json' } : {}) },
    signal: AbortSignal.timeout(30_000),
  })
  const value = await response.json()
  assert.equal(response.status, expected, JSON.stringify(value))
  return { value: value.data ?? value, response }
}

try {
  if (!origin) {
    docker('run', '-d', '--name', container, '-p', '127.0.0.1::8000', '-e', 'DATABASE_BACKUP_SCHEDULE=off', image)
    started = true
    origin = 'http://' + docker('port', container, '8000/tcp').split('\n')[0]
  }
  await until(async () => {
    try { return (await fetch(origin + '/api/v1/system/health', { signal: AbortSignal.timeout(1500) })).ok } catch { return false }
  }, 'platform readiness')
  assert.equal((await api('/system/initialization')).value.initialized, false, 'Install tests require an isolated new host')
  const user = { username: 'release-test', password: 'fixture-' + randomUUID() }
  await api('/system/initialize', 'POST', { ...user, confirm_password: user.password, system_name: 'Package test' }, 201)
  const login = await api('/auth/login', 'POST', user, 201)
  cookie = login.response.headers.get('set-cookie').split(';')[0]
  for (const name of packages) {
    const zip = await readFile(path.join(root, name))
    const manifest = JSON.parse(new AdmZip(zip).readAsText('manifest.json'))
    const form = new FormData()
    form.set('file', new Blob([zip]), name)
    const op = (await api('/modules/install', 'POST', form, 202)).value
    const result = await until(async () => {
      const result = (await api(`/modules/${manifest.id}/operations/${op.id}`)).value
      assert.notEqual(result.status, 'failed', JSON.stringify(result))
      return result.status === 'completed' && result
    }, manifest.id + ' install')
    assert.ok(result.releaseId)
    const route = `/modules/${manifest.id}/enabled`
    assert.equal((await api(route, 'PUT', { enabled: true })).value.status, 'enabled')
    if (manifest.runtime?.http_shutdown) {
      await api(`/modules/${manifest.id}/health/shutdown`, 'POST', undefined, 404)
    }
    await api(route, 'PUT', { enabled: false })
    console.log(`${name}: installed, ready, stopped`)
  }
} catch (err) {
  if (started) {
    try { console.error(docker('logs', '--tail', '60', container)) } catch { /* preserve error */ }
  }
  throw err
} finally {
  if (started) {
    docker('stop', '--time', '60', container)
    docker('rm', '-v', container)
  }
}
