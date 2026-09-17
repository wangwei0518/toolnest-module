import { readFileSync, readdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

const rootDir = process.cwd()
const modulesDir = path.join(rootDir, 'modules')
const modules = readdirSync(modulesDir)
  .filter((entry) => statSync(path.join(modulesDir, entry)).isDirectory())
  .sort()

if (modules.length === 0) throw new Error('modules/ 下没有可打包模块')

for (const id of modules) {
  const manifest = JSON.parse(readFileSync(path.join(modulesDir, id, 'manifest.json'), 'utf8'))
  const args = ['scripts/package-module.mjs', '--id', manifest.id, '--module-dir', id, '--no-version-bump']
  const result = spawnSync(process.execPath, args, { cwd: rootDir, stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`模块打包失败：${id}`)
}
