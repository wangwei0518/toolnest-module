import { readFileSync, readdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

const rootDir = process.cwd()
const modulesDir = path.join(rootDir, 'modules')
const head = process.env.RELEASE_HEAD_SHA || 'HEAD'
const requestedBase = process.env.RELEASE_BASE_SHA?.trim()
const base = resolveBase(requestedBase, head)
const changedFiles = base ? gitLines(['diff', '--name-only', `${base}..${head}`]) : []
const sharedInputsChanged = changedFiles.some(isSharedReleaseInput)
const moduleDirs = readdirSync(modulesDir)
  .filter((entry) => statSync(path.join(modulesDir, entry)).isDirectory())
  .sort()

if (moduleDirs.length === 0) throw new Error('modules/ 下没有可打包模块')

console.log(`[release] 对比范围：${base ?? '无可用基线，按当前版本打包'}..${head}`)

for (const moduleDir of moduleDirs) {
  const manifestPath = `modules/${moduleDir}/manifest.json`
  const manifest = JSON.parse(readFileSync(path.join(rootDir, manifestPath), 'utf8'))
  const moduleChanged = changedFiles.some((file) => file.startsWith(`modules/${moduleDir}/`))
  const versionChanged = base ? manifestVersionAt(base, manifestPath) !== manifest.version : true
  const shouldBump = (moduleChanged || sharedInputsChanged) && !versionChanged
  const args = ['scripts/package-module.mjs', '--id', manifest.id, '--module-dir', moduleDir]
  if (!shouldBump) args.push('--no-version-bump')

  const reason = shouldBump
    ? '检测到影响发布包的变更，自动递增补丁版本'
    : versionChanged
      ? '提交中已更新版本，保留当前版本'
      : '模块未受影响，保留当前版本'
  console.log(`[release] ${manifest.id}: ${reason}`)
  run(process.execPath, args)
}

function resolveBase(value, target) {
  if (value && !/^0+$/.test(value) && gitOk(['cat-file', '-e', `${value}^{commit}`])) return value
  const parent = gitLines(['rev-list', '--parents', '-n', '1', target])[0]?.split(' ')[1]
  return parent || null
}

function manifestVersionAt(revision, manifestPath) {
  const result = spawnSync('git', ['show', `${revision}:${manifestPath}`], {
    cwd: rootDir,
    encoding: 'utf8',
  })
  if (result.status !== 0) return null
  return JSON.parse(result.stdout).version ?? null
}

function isSharedReleaseInput(file) {
  return file.startsWith('packages/')
    || file.startsWith('scripts/')
    || ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'].includes(file)
}

function gitLines(args) {
  const result = spawnSync('git', args, { cwd: rootDir, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`)
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

function gitOk(args) {
  return spawnSync('git', args, { cwd: rootDir, stdio: 'ignore' }).status === 0
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: rootDir, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`)
}
