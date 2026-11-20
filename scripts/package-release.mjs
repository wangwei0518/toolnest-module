import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

const rootDir = process.cwd()
const modulesDir = path.join(rootDir, 'modules')
const planFile = path.join(rootDir, 'module-release-plan.json')
const mode = process.argv[2] || '--prepare'
if (mode === '--build') {
  const target = process.env.RELEASE_TARGET_PLATFORM
  if (!['linux/amd64', 'linux/arm64', 'windows/amd64'].includes(target)) throw new Error('缺少受支持的发布平台')
  const output = path.join(rootDir, 'release-assets')
  mkdirSync(output, { recursive: true })
  for (const item of JSON.parse(readFileSync(planFile, 'utf8'))) {
    if (item.targets.length ? !item.targets.includes(target) : target !== 'linux/amd64') continue
    const args = item.targets.length ? ['--target', target] : []
    run(process.execPath, ['scripts/package-module.mjs', '--id', item.id, '--module-dir', item.dir, '--no-version-bump', ...args])
    run(process.execPath, ['scripts/check-module-budgets.mjs', '--id', item.id, ...args])
    const suffix = item.targets.length ? `-${target.replace('/', '-')}` : ''
    const filename = `${item.id}-${item.version}${suffix}.tnmod`
    copyFileSync(path.join(modulesDir, item.dir, 'dist', filename), path.join(output, filename))
  }
  process.exit(0)
}
if (mode !== '--prepare') throw new Error('未知的模块发布阶段')
const head = process.env.RELEASE_HEAD_SHA || 'HEAD'
const requestedBase = process.env.RELEASE_BASE_SHA?.trim()
const lastPublished = gitLines(['log', '-1', '--format=%H', '--', existsSync('catalog-v2.json') ? 'catalog-v2.json' : 'catalog.json'])[0]
const base = resolveBase(lastPublished || requestedBase, head)
const changedFiles = base ? gitLines(['diff', '--name-only', `${base}..${head}`]) : []
const sharedInputsChanged = changedFiles.some(isSharedReleaseInput)
const catalogPath = path.join(rootDir, 'catalog-v2.json')
const previous = existsSync(catalogPath) ? JSON.parse(readFileSync(catalogPath, 'utf8')) : JSON.parse(readFileSync('catalog.json', 'utf8'))
const existingV2 = previous.schema_version === 2
const plan = []
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
  const targets = manifest.runtime?.kind === 'native' ? Object.keys(manifest.runtime.executables) :
    manifest.id === 'xiaomi-rear-wallpaper' ? ['linux/amd64', 'linux/arm64', 'windows/amd64'] : []
  const published = previous.modules.find(item => item.id === manifest.id)
  const splitExistingPackage = !existingV2 && targets.length > 0
  if (!moduleChanged && !sharedInputsChanged && !splitExistingPackage && published?.version === manifest.version) continue
  const shouldBump = published?.version === manifest.version || (!published && !versionChanged)
  const args = ['scripts/package-module.mjs', '--id', manifest.id, '--module-dir', moduleDir, '--version-only']
  if (!shouldBump) args.push('--no-version-bump')

  const reason = shouldBump
    ? '检测到影响发布包的变更，自动递增补丁版本'
    : versionChanged
      ? '提交中已更新版本，保留当前版本'
      : '模块未受影响，保留当前版本'
  console.log(`[release] ${manifest.id}: ${reason}`)
  run(process.execPath, args)
  const prepared = JSON.parse(readFileSync(path.join(rootDir, manifestPath), 'utf8'))
  plan.push({ id: prepared.id, version: prepared.version, dir: moduleDir, targets })
}
writeFileSync(planFile, JSON.stringify(plan))

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
    || file === 'scripts/bundle-backend.mjs'
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
