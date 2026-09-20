import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`watchdog child did not exit within ${timeoutMs}ms`))
    }, timeoutMs)
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      resolve({ code, signal })
    })
  })
}

test('bundled backend exits after its declared parent disappears', async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'toolnest-watchdog-'))
  const output = path.join(temporaryDirectory, 'backend.mjs')
  try {
    const bundler = spawn(process.execPath, [
      'scripts/bundle-backend.mjs',
      'test/fixtures/watchdog-entry.mjs',
      output,
    ], { cwd: process.cwd(), stdio: 'inherit' })
    const bundled = await waitForExit(bundler, 10_000)
    assert.equal(bundled.code, 0)

    const child = spawn(process.execPath, [output], {
      env: {
        ...process.env,
        TOOLNEST_PLUGIN_PARENT_PID: '2147483647',
        TOOLNEST_PLUGIN_PARENT_CHECK_INTERVAL_MS: '100',
      },
      stdio: 'ignore',
    })
    const startedAt = Date.now()
    const exited = await waitForExit(child, 5_000)
    assert.ok(Date.now() - startedAt < 5_000)
    assert.ok(exited.code !== 0 || exited.signal !== null)
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
})
