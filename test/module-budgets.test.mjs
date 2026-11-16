import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import test from 'node:test'
import AdmZip from 'adm-zip'

const checker = fileURLToPath(new URL('../scripts/check-module-budgets.mjs', import.meta.url))

function check(files, excludedPackageFiles = [], args = []) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'toolnest-budget-'))
  const moduleDir = path.join(root, 'modules', 'temporary-transfer')
  mkdirSync(path.join(moduleDir, 'dist'), { recursive: true })
  writeFileSync(path.join(moduleDir, 'manifest.json'), JSON.stringify({ id: 'temporary-transfer', version: '0.1.0' }))
  const archive = new AdmZip()
  for (const [name, source] of Object.entries(files)) {
    const file = path.join(moduleDir, 'frontend', 'dist', name)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, source)
    if (!excludedPackageFiles.includes(name)) archive.addFile(`frontend/dist/${name}`, Buffer.from(source))
  }
  archive.writeZip(path.join(moduleDir, 'dist', 'temporary-transfer-0.1.0.tnmod'))
  const result = spawnSync(process.execPath, [checker, ...args], { cwd: root, encoding: 'utf8' })
  return { status: result.status, output: result.stdout + result.stderr }
}

test('counts both standalone entry graphs and deduplicates shared chunks', () => {
  const files = {
    'index.js': 'import "./shared.js";',
    'guest.js': 'import "./shared.js"; import("./guest-details.js");',
    'shared.js': 'export const shared = 1;',
    'guest-details.js': 'export const details = 2;',
  }
  const result = check(files, [], ['--id', 'temporary-transfer'])
  assert.equal(result.status, 0, result.output)
  const total = Object.values(files).reduce((sum, source) => sum + gzipSync(source, { level: 9 }).length, 0)
  assert.ok(result.output.includes(`all reachable JS gzip: ${(total / 1024).toFixed(1)} KiB`), result.output)
})

test('still rejects genuinely unreferenced JavaScript', () => {
  const result = check({ 'index.js': '', 'guest.js': '', 'orphan.js': 'export const orphan = 1;' })
  assert.equal(result.status, 1)
  assert.match(result.output, /orphan\.js/)
})

test('requires the declared guest build output', () => {
  const result = check({ 'index.js': '' })
  assert.equal(result.status, 1)
  assert.match(result.output, /缺少当前版本构建产物/)
})

test('requires the guest entry to be included in the installable package', () => {
  const result = check({ 'index.js': '', 'guest.js': '' }, ['guest.js'])
  assert.equal(result.status, 1)
  assert.match(result.output, /tnmod 缺少入口 frontend\/dist\/guest\.js/)
})

test('enforces the initial budget independently for each page', () => {
  const result = check({
    'index.js': `export default "${randomBytes(190 * 1024).toString('base64')}";`,
    'guest.js': `export default "${randomBytes(190 * 1024).toString('base64')}";`,
  })
  assert.equal(result.status, 0, result.output)
})

test('does not exempt an oversized guest page from the initial budget', () => {
  const result = check({ 'index.js': '', 'guest.js': `export default "${randomBytes(340 * 1024).toString('base64')}";` })
  assert.equal(result.status, 1)
  assert.match(result.output, /initial JS gzip: .*超限/)
})

test('fails a misspelled module filter instead of silently skipping validation', () => {
  const result = check({ 'index.js': '', 'guest.js': '' }, [], ['--id', 'missing'])
  assert.notEqual(result.status, 0)
  assert.match(result.output, /模块不存在/)
})
