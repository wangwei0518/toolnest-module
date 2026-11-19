import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const [nodePackage, goPackage] = process.argv.slice(2)
assert.ok(nodePackage && goPackage, 'Provide the Node and Go .tnmod packages')
const image = process.env.TOOLNEST_GO_TEST_IMAGE || 'toolnest-native-check:local'
const name = 'toolnest-anime-contract-' + randomUUID().slice(0, 8)
const id = 'anime-calendar-react'
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
    method: 'POST', code: 201, body: { username, password, confirm_password: password, system_name: 'Anime migration test' },
  })
  const login = await api('/auth/login', { method: 'POST', code: 201, body: { username, password } })
  cookie = login.response.headers.get('set-cookie').split(';')[0]
  const previous = await upload('/modules/install', nodePackage)
  const fixture = {
    id: 'bangumi:975', provider: 'bangumi', provider_id: '975', title_cn: '航海王', title_original: 'ONE PIECE',
    title_romaji: '', cover_url: '', studio: 'Toei', year: 1999, cour_month: 10, cour_label: '1999年10月新番',
    air_date: '1999-10-20', estimated_end_date: null, cour_relation: 'unknown', cour_relation_label: '未定',
    air_time: '', air_month: '1999-10', weekday: 3, status: 'airing', media_type: 'tv',
    episode_count: 1191, current_episode: null, score: null, summary: '', tags: [],
    external_url: 'https://bgm.tv/subject/975', region: 'jp', raw: {}, mark_type: null,
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  }
  const seed = {
    weeklyCache: { cache_date: '2026-01-01', updated_at: '2026-01-01T00:00:00.000Z', items: [fixture] },
    settings: { dataRefreshTime: '23:59' },
  }
  execFileSync('docker', ['exec', '-i', name, 'sh', '-c',
    'mkdir -p "$PLUGIN_DATA_DIR/anime-calendar-react/data" && tee "$PLUGIN_DATA_DIR/anime-calendar-react/data/anime-calendar-state.json" >/dev/null'],
  { input: JSON.stringify(seed) })
  await api(root + '/enable', { method: 'POST', code: 201 })
  await readRoute('/items/bangumi%3A975/mark', { method: 'POST', body: { mark_type: 'watching' } })
  const settings = await readRoute('/calendar-settings')
  const saved = { ...settings, dataRefreshTime: '23:59', defaultPage: 'weekly' }
  assert.deepEqual(await readRoute('/calendar-settings', { method: 'PUT', body: saved }), saved)

  // Explicit dates avoid the clock boundary between the two processes.
  const inputs = ['/items?year=2000&cour_month=1', '/stats?year=2000&cour_month=1', '/calendar-settings']
  const before = await Promise.all(inputs.map(path => readRoute(path)))
  const current = await readRoute('/cour/current')
  const followingPath = '/items?year=' + current.year + '&cour_month=' + current.cour_month + '&mark_type=watching'
  const followed = await readRoute(followingPath)
  assert.ok(followed.items.some(item => item.id === fixture.id && item.cour_relation === 'long_running'))
  const upgraded = await upload(root + '/upgrade', goPackage)
  assert.notEqual(previous.releaseId, upgraded.releaseId)
  assert.deepEqual(await Promise.all(inputs.map(path => readRoute(path))), before)
  assert.deepEqual(await readRoute(followingPath), followed)
  assert.deepEqual(await readRoute('/hello'), { message: '新番日历模块已连接。' })
  assert.equal((await readRoute('/weekly')).days.length, 7)

  const savedByGo = { ...saved, defaultRegion: 'jp' }
  assert.deepEqual(await readRoute('/calendar-settings', { method: 'PUT', body: savedByGo }), savedByGo)
  await operation(root + '/rollback', { release_id: previous.releaseId })
  assert.deepEqual(await readRoute('/calendar-settings'), savedByGo)
  assert.deepEqual(await readRoute(followingPath), followed)
  console.log('Node → Go → Node: install, upgrade, gateway parity, settings persistence, rollback passed')
} catch (error) {
  try { console.error(docker('logs', '--tail', '60', name)) } catch {}
  throw error
} finally {
  try { docker('stop', '-t', '20', name) } catch {}
}
