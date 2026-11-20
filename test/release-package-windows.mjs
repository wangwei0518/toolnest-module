import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import AdmZip from 'adm-zip'

const database = process.env.TOOLNEST_TEST_DATABASE_URL
const assets = 'release-assets'
for (const file of (await readdir(assets)).filter(name => name.endsWith('.tnmod'))) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'toolnest-release-'))
  let child
  try {
    const archive = new AdmZip(path.join(assets, file))
    const manifest = JSON.parse(archive.readAsText('manifest.json'))
    assert.equal(manifest.package_target, 'windows/amd64')
    const entry = manifest.runtime.kind === 'native' ? manifest.runtime.executables['windows/amd64'] : manifest.runtime.entry
    archive.extractAllTo(root)
    const socket = createServer()
    socket.listen(0, '127.0.0.1')
    await once(socket, 'listening')
    const { port } = socket.address()
    await new Promise(resolve => socket.close(resolve))
    const token = randomUUID()
    const executable = path.join(root, entry)
    child = spawn(manifest.runtime.kind === 'native' ? executable : process.execPath, manifest.runtime.kind === 'native' ? [] : [executable], {
      cwd: root, stdio: 'inherit', windowsHide: true,
      env: { ...process.env, TOOLNEST_PLUGIN_ID: manifest.id, TOOLNEST_PLUGIN_RELEASE_ID: 'windows-fixture', TOOLNEST_PLUGIN_PORT: String(port), TOOLNEST_PLUGIN_TOKEN: token,
        TOOLNEST_PLUGIN_PARENT_PID: String(process.pid), TOOLNEST_PLUGIN_DATA_DIR: path.join(root, 'data'), TOOLNEST_PLUGIN_LOG_DIR: path.join(root, 'logs'),
        TOOLNEST_PLUGIN_DATABASE_URL: database, TOOLNEST_PLUGIN_DATABASE_SCHEMA: 'public' },
    })
    await once(child, 'spawn')
    let ready = false
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) break
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health/ready`, { headers: { 'X-Toolnest-Internal-Token': token }, signal: AbortSignal.timeout(1200) })
        if (response.ok && (await response.json()).ready === true) { ready = true; break }
      } catch { /* wait for startup */ }
      await delay(250)
    }
    assert.ok(ready, `${file} did not become ready`)
    if (manifest.runtime.http_shutdown) {
      const exit = once(child, 'exit')
      const response = await fetch(`http://127.0.0.1:${port}/health/shutdown`, {
        method: 'POST', headers: { 'X-Toolnest-Internal-Token': token }, signal: AbortSignal.timeout(5000),
      })
      assert.equal(response.status, 204)
      const [code] = await Promise.race([exit, delay(21000, null, { ref: false }).then(() => [null])])
      assert.equal(code, 0)
    }
    console.log(`${file}: ready on Windows`)
  } finally {
    if (child?.pid && child.exitCode === null) {
      const closed = once(child, 'exit')
      child.kill()
      await closed
    }
    await rm(root, { recursive: true, force: true, maxRetries: 3 })
  }
}
