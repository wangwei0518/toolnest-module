import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import AdmZip from '../node_modules/adm-zip/adm-zip.js'

const rootDir = process.cwd()
const options = parseArgs(process.argv.slice(2))
const moduleDir = path.join(rootDir, 'modules', options.moduleDir || options.id)
const manifestPath = path.join(moduleDir, 'manifest.json')
const backendDir = path.join(moduleDir, 'backend')
const frontendDir = path.join(moduleDir, 'frontend')
const stagingDir = path.join(moduleDir, '.package-staging')
const outputDir = path.join(moduleDir, 'dist')
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const binSuffix = process.platform === 'win32' ? '.cmd' : ''
const frontendViteCommand = path.join(frontendDir, 'node_modules', '.bin', `vite${binSuffix}`)
const backendTscCommand = path.join(backendDir, 'node_modules', '.bin', `tsc${binSuffix}`)

function parseArgs(argv) {
  const result = { id: '', moduleDir: '', versionBump: true }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--id') result.id = argv[++index] ?? ''
    else if (value === '--module-dir') result.moduleDir = argv[++index] ?? ''
    else if (value === '--no-version-bump') result.versionBump = false
    else if (!result.id && !value.startsWith('-')) result.id = value
  }
  if (!result.id) throw new Error('请提供模块 ID，例如：pnpm package:module -- --id demo-module')
  return result
}

function run(command, args, cwd = rootDir, extraEnv = {}) {
  const isWindowsBatch = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command)
  const executable = isWindowsBatch ? (process.env.ComSpec ?? 'cmd.exe') : command
  const spawnArgs = isWindowsBatch
    ? ['/d', '/s', '/c', [quoteWindowsArg(command), ...args.map(quoteWindowsArg)].join(' ')]
    : args
  const result = spawnSync(executable, spawnArgs, {
    cwd,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`)
}

function runStep(label, command, args, cwd = rootDir, extraEnv = {}) {
  const startedAt = Date.now()
  console.log(`[toolnest-module] ${label}：开始`)
  run(command, args, cwd, extraEnv)
  console.log(`[toolnest-module] ${label}：完成（${Date.now() - startedAt}ms）`)
}

function quoteWindowsArg(value) {
  return /[\s"&|<>^]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value
}

function readManifest() {
  if (!existsSync(manifestPath)) throw new Error(`模块清单不存在：${path.relative(rootDir, manifestPath)}`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest.id !== options.id) throw new Error(`manifest.id 与模块目录不一致：${manifest.id}`)
  if (typeof manifest.version !== 'string' || !manifest.version.trim()) {
    throw new Error('manifest.version 必须是非空字符串')
  }
  return manifest
}

function incrementPatchVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())
  if (!match) throw new Error(`暂不支持自动递增非标准三段版本号：${version}`)
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function replaceVersion(filePath, currentVersion, nextVersion, label) {
  const source = readFileSync(filePath, 'utf8')
  const pattern = versionPattern(currentVersion, label)
  const next = source.replace(pattern, `$1${nextVersion}$2`)
  if (next === source) throw new Error(`${label}未找到当前版本 ${currentVersion}：${path.relative(rootDir, filePath)}`)
  writeFileSync(filePath, next)
}

function versionPattern(version, label) {
  const escapedVersion = escapeRegExp(version)
  return label === '入口'
    ? new RegExp(`(version\\s*:\\s*["'])${escapedVersion}(["'])`)
    : new RegExp(`("version"\\s*:\\s*["'])${escapedVersion}(["'])`)
}

function syncModuleVersion(currentVersion, nextVersion) {
  const versionFiles = moduleVersionFiles()
  assertModuleVersionSync(currentVersion, versionFiles)
  for (const [filePath, label] of versionFiles) replaceVersion(filePath, currentVersion, nextVersion, label)
}

function moduleVersionFiles() {
  return [
    [manifestPath, '模块清单'],
    [path.join(frontendDir, 'package.json'), 'React 前端包'],
    [path.join(backendDir, 'package.json'), 'Node 后端包'],
    [path.join(frontendDir, 'src', 'index.tsx'), '入口'],
  ]
}

function assertModuleVersionSync(currentVersion, versionFiles = moduleVersionFiles()) {
  for (const [filePath, label] of versionFiles) {
    if (!versionPattern(currentVersion, label).test(readFileSync(filePath, 'utf8'))) {
      throw new Error(`${label}未与模块清单版本 ${currentVersion} 同步：${path.relative(rootDir, filePath)}`)
    }
  }
}

function productionDependencyCacheKey(packageJson) {
  const dependencyInput = {
    dependencies: packageJson.dependencies ?? {},
    optionalDependencies: packageJson.optionalDependencies ?? {},
    peerDependencies: packageJson.peerDependencies ?? {},
    overrides: packageJson.overrides ?? {},
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  }
  return createHash('sha256').update(JSON.stringify(dependencyInput)).digest('hex').slice(0, 20)
}

function hasProductionDependencies(packageJson) {
  return Object.keys(packageJson.dependencies ?? {}).length > 0
    || Object.keys(packageJson.optionalDependencies ?? {}).length > 0
    || Object.keys(packageJson.peerDependencies ?? {}).length > 0
}

function ensureBackendProductionDependencies() {
  const packageJsonPath = path.join(backendDir, 'package.json')
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  const cacheKey = productionDependencyCacheKey(packageJson)
  const cacheRoot = path.join(os.tmpdir(), 'toolnest-module-dependency-cache', options.id)
  const cacheDir = path.join(cacheRoot, cacheKey)
  const cachedNodeModules = path.join(cacheDir, 'node_modules')
  const cacheReady = existsSync(cachedNodeModules) && lstatSync(cachedNodeModules).isDirectory()
  if (cacheReady) {
    console.log(`[toolnest-module] 后端生产依赖缓存：命中（${cacheKey}）`)
    return cachedNodeModules
  }

  if (!hasProductionDependencies(packageJson)) {
    mkdirSync(cachedNodeModules, { recursive: true })
    console.log(`[toolnest-module] 后端无生产依赖，使用空依赖目录（${cacheKey}）`)
    return cachedNodeModules
  }

  const installDir = path.join(os.tmpdir(), `toolnest-${options.id}-react-backend-deploy-${process.pid}`)
  const cacheBuildDir = path.join(cacheRoot, `${cacheKey}.tmp-${process.pid}`)
  rmSync(installDir, { recursive: true, force: true })
  rmSync(cacheBuildDir, { recursive: true, force: true })
  mkdirSync(installDir, { recursive: true })
  cpSync(packageJsonPath, path.join(installDir, 'package.json'))
  try {
    runStep('安装后端生产依赖（首次或依赖变更）', npmCommand, ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'], installDir, { CI: 'true' })
    mkdirSync(cacheRoot, { recursive: true })
    mkdirSync(cacheBuildDir, { recursive: true })
    copyDereferenced(path.join(installDir, 'node_modules'), path.join(cacheBuildDir, 'node_modules'))
    if (!existsSync(cacheDir)) {
      renameSync(cacheBuildDir, cacheDir)
    } else {
      rmSync(cacheBuildDir, { recursive: true, force: true })
    }
    console.log(`[toolnest-module] 后端生产依赖缓存：已写入（${cacheKey}）`)
    return cachedNodeModules
  } finally {
    rmSync(installDir, { recursive: true, force: true })
    rmSync(cacheBuildDir, { recursive: true, force: true })
  }
}

function assertDirectory(directory, label) {
  if (!existsSync(directory) || !lstatSync(directory).isDirectory()) {
    throw new Error(`${label} 不存在：${path.relative(rootDir, directory)}`)
  }
}

const currentManifest = readManifest()
assertDirectory(frontendDir, 'React 前端目录')
assertDirectory(backendDir, 'Node 后端目录')

if (options.versionBump) {
  const nextVersion = incrementPatchVersion(currentManifest.version)
  syncModuleVersion(currentManifest.version, nextVersion)
  console.log(`[toolnest-module] 版本自动递增：${currentManifest.version} → ${nextVersion}`)
}

const manifest = readManifest()
assertModuleVersionSync(manifest.version)

runStep('构建 React 前端', frontendViteCommand, ['build'], frontendDir)
runStep('检查 Node 后端类型', backendTscCommand, ['-p', 'tsconfig.json'], backendDir)

const outputFile = path.join(outputDir, `${manifest.id}-${manifest.version}.tnmod`)
rmSync(stagingDir, { recursive: true, force: true })
rmSync(outputFile, { force: true })
mkdirSync(stagingDir, { recursive: true })
mkdirSync(outputDir, { recursive: true })

const stagingStartedAt = Date.now()
cpSync(manifestPath, path.join(stagingDir, 'manifest.json'))
cpSync(path.join(frontendDir, 'dist'), path.join(stagingDir, 'frontend', 'dist'), { recursive: true })
cpSync(path.join(backendDir, 'dist'), path.join(stagingDir, 'backend', 'dist'), { recursive: true })
cpSync(path.join(backendDir, 'package.json'), path.join(stagingDir, 'backend', 'package.json'))
console.log(`[toolnest-module] 准备发布目录：完成（${Date.now() - stagingStartedAt}ms）`)

const cachedNodeModules = ensureBackendProductionDependencies()
const dependencyCopyStartedAt = Date.now()
copyDereferenced(cachedNodeModules, path.join(stagingDir, 'backend', 'node_modules'))
console.log(`[toolnest-module] 复制后端生产依赖：完成（${Date.now() - dependencyCopyStartedAt}ms）`)

const archive = new AdmZip()
const archiveStartedAt = Date.now()
addDirectory(stagingDir)
archive.writeZip(outputFile)
console.log(`[toolnest-module] 压缩 tnmod 包：完成（${Date.now() - archiveStartedAt}ms）`)
rmSync(stagingDir, { recursive: true, force: true })
console.log(`已生成 ${path.relative(rootDir, outputFile)}`)

function addDirectory(currentDir, relativeDir = '') {
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    if (entry.name === '.package-staging') continue
    const absolutePath = path.join(currentDir, entry.name)
    const archivePath = path.posix.join(relativeDir, entry.name)
    if (entry.isDirectory()) addDirectory(absolutePath, archivePath)
    else if (entry.isFile()) {
      const parent = path.posix.dirname(archivePath)
      archive.addLocalFile(absolutePath, parent === '.' ? '' : parent, entry.name)
    }
  }
}

function copyDereferenced(source, destination) {
  const info = lstatSync(source)
  if (info.isSymbolicLink()) return copyDereferenced(realpathSync(source), destination)
  if (info.isDirectory()) {
    mkdirSync(destination, { recursive: true })
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      if (entry.name === '.bin' || entry.name === '.package-lock.json') continue
      copyDereferenced(path.join(source, entry.name), path.join(destination, entry.name))
    }
    return
  }
  mkdirSync(path.dirname(destination), { recursive: true })
  copyFileSync(source, destination)
}
