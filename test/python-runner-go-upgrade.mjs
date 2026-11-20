import assert from 'node:assert/strict'
import AdmZip from 'adm-zip'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const [nodePackage, goPackage] = process.argv.slice(2)
assert.ok(nodePackage && goPackage, 'Provide the Node and Go .tnmod packages')
const image = process.env.TOOLNEST_GO_TEST_IMAGE || 'toolnest-distribution:local'
const name = 'toolnest-python-contract-' + randomUUID().slice(0, 8)
const id = 'python-runner'
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

async function api(path, { method = 'GET', body, code = 200, headers: extraHeaders } = {}) {
  const payload = body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body)
  const headers = { ...extraHeaders }
  if (cookie) headers.cookie = cookie
  if (typeof payload === 'string') headers['content-type'] = 'application/json'
  const response = await fetch(origin + '/api/v1' + path, { method, body: payload, headers, signal: AbortSignal.timeout(30_000) })
  const result = await response.json()
  assert.equal(response.status, code, method + ' ' + path + ': ' + JSON.stringify(result))
  return { result, response }
}

async function operation(path, body, headers) {
  const { result } = await api(path, { method: 'POST', body, code: 202, headers })
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
    method: 'POST', code: 201, body: { username, password, confirm_password: password, system_name: 'Python Runner migration test' },
  })
  const login = await api('/auth/login', { method: 'POST', code: 201, body: { username, password } })
  cookie = login.response.headers.get('set-cookie').split(';')[0]
  const previous = await upload('/modules/install', nodePackage)
  await api(root + '/enable', { method: 'POST', code: 201 })
  const archive = new AdmZip()
  archive.addFile('main.py', Buffer.from("print('项目第一行')\nprint('项目第二行')\n"))
  archive.addFile('daemon.py', Buffer.from("import time\nprint('常驻任务已启动')\ntime.sleep(60)\n"))
  archive.addFile('requirements.txt', Buffer.from('# fixture\n'))
  archive.addFile('config.json', Buffer.from(JSON.stringify({ name: '原有配置', api_key: 'fixture-secret' })))
  const form = new FormData()
  form.set('file', new Blob([archive.toBuffer()], { type: 'application/zip' }), 'fixture.zip')
  form.set('name', '原有项目')
  const project = await readRoute('/uploads/archive', { method: 'POST', body: form })
  assert.ok(project.id)
  const projectPath = '/uploads/' + project.id
  const source = { type: 'archive', project_id: project.id, entry_file: 'main.py' }
  const before = await readRoute('/executions', { method: 'POST', body: { name: '旧版执行', source } })
  assert.equal(before.status, 'success')
  assert.equal(before.stdout, '项目第一行\n项目第二行\n')
  const venv = await readRoute(projectPath + '/environment/create', { method: 'POST' })
  assert.equal(venv.status, 'ready')
  const scheduled = await readRoute('/scheduled-tasks', {
    method: 'POST', body: {
      name: '升级后自动触发', schedule_type: 'once',
      run_at: new Date(Date.now() + 30_000).toISOString(), timezone: 'Asia/Shanghai', source,
    },
  })
  const upgraded = await upload(root + '/upgrade', goPackage)
  assert.notEqual(previous.releaseId, upgraded.releaseId)

  // Keep the gateway idle beyond the due time and one complete scheduler tick.
  await delay(Math.max(0, Date.parse(scheduled.run_at) - Date.now()) + 17_000)
  const checkedAt = Date.now()
  const ran = await readRoute('/scheduled-tasks/' + scheduled.id)
  assert.equal(ran.total_runs, 1)
  assert.equal(ran.last_status, 'success')
  assert.ok(Date.parse(ran.last_run_at) < checkedAt - 700, 'schedule must have run before first module request')
  assert.equal((await readRoute(projectPath)).name, '原有项目')
  assert.equal((await readRoute(projectPath + '/environment')).python_executable, venv.python_executable)
  assert.equal((await readRoute('/executions/' + before.id)).stdout, before.stdout)
  const config = await readRoute(projectPath + '/config')
  assert.equal(config.values.api_key, '********')
  await readRoute(projectPath + '/config', { method: 'PUT', body: { values: { ...config.values, name: 'Go 更新' } } })
  const executed = await readRoute('/executions', { method: 'POST', body: { name: 'Go 执行', source, runtime_environment: 'project_venv' } })
  assert.equal(executed.status, 'success')
  assert.equal(executed.stdout, before.stdout)
  assert.equal((await readRoute(projectPath + '/files/preview?path=main.py')).language, 'python')
  const timeline = await readRoute('/timeline')
  assert.ok(timeline.items.some(item => item.schedule_id === scheduled.id))
  const overview = await readRoute('/overview')
  assert.equal(overview.recent_logs.find(log => log.execution_id === executed.id).content, executed.stdout)
  assert.ok((await readRoute(projectPath + '/storage')).source_size > 0)
  const installed = await readRoute(projectPath + '/environment/install-requirements', { method: 'POST', body: {} })
  assert.equal(installed.last_install_status, 'success')
  assert.equal(typeof (await readRoute(projectPath + '/environment/install-log')).content, 'string')
  const persistent = await readRoute('/persistent-tasks', {
    method: 'POST', body: { name: '常驻任务', source: { ...source, entry_file: 'daemon.py' }, auto_start: true },
  })
  assert.equal(persistent.status, 'running')
  const persistentPath = '/persistent-tasks/' + persistent.id
  await wait(async () => (await readRoute(persistentPath + '/logs')).lines.includes('常驻任务已启动'), 'persistent output')
  assert.equal((await readRoute(persistentPath + '/restart', { method: 'POST' })).status, 'running')
  assert.equal((await readRoute(persistentPath + '/stop', { method: 'POST' })).status, 'stopped')
  assert.ok((await readRoute(persistentPath + '/events')).some(event => event.event_type === 'stopped'))
  await readRoute(persistentPath, { method: 'DELETE' })

  archive.updateFile('main.py', Buffer.from("print('更新后')\n"))
  const update = new FormData()
  update.set('file', new Blob([archive.toBuffer()], { type: 'application/zip' }), 'fixture-update.zip')
  update.set('confirm_schedule_impact', 'true')
  assert.equal((await readRoute(projectPath + '/update', { method: 'POST', body: update })).updated, true)
  assert.match((await readRoute(projectPath + '/files/preview?path=main.py')).content, /更新后/)
  assert.equal((await readRoute(projectPath + '/rollback', { method: 'POST', body: { confirm_schedule_impact: true } })).rolled_back, true)
  assert.match((await readRoute(projectPath + '/files/preview?path=main.py')).content, /项目第一行/)

  if (process.env.TOOLNEST_GO_TEST_BINARY) {
    await api(root + '/disable', { method: 'POST', code: 201 })
    // Reproduce the recovery marker written by a cross-architecture restore
    // inside this disposable platform container.
    const marker = {
      id, version: JSON.parse(new AdmZip(goPackage).readAsText('manifest.json')).version, release: upgraded.releaseId, enabled: true,
      target: 'linux/amd64', packageNeeded: false, python: true,
    }
    assert.ok(marker.version)
    docker('exec', name, 'node', '-e',
      "const fs = require('node:fs'); fs.writeFileSync('/app/data/plugins/python-runner/recovery.json', Buffer.from(process.argv[1], 'base64'))",
      Buffer.from(JSON.stringify(marker)).toString('base64'))
    await operation('/system/database/module-recovery/python-environments', undefined, { 'X-Toolnest-Confirm-Recovery': 'true' })
    await api('/system/database/module-recovery/python-runner/resume', { method: 'POST' })
    const recovered = await readRoute(projectPath + '/environment')
    assert.equal(recovered.status, 'ready')
    assert.equal(recovered.last_install_status, 'success')
    assert.ok(Date.parse(recovered.last_install_at) > Date.parse(installed.last_install_at))
  }

  await operation(root + '/rollback', { release_id: previous.releaseId })
  assert.equal((await readRoute(projectPath + '/config')).values.name, 'Go 更新')
  assert.equal((await readRoute('/executions/' + executed.id)).stdout, executed.stdout)
  assert.equal((await readRoute('/scheduled-tasks/' + scheduled.id)).total_runs, 1)
  console.log('Python Runner Node → Go → Node: projects, virtual environment, Unicode output, configuration and eager scheduling verified')
} catch (error) {
  try { console.error(docker('logs', '--tail', '60', name)) } catch {}
  throw error
} finally {
  try { docker('stop', '-t', '20', name) } catch {}
}
