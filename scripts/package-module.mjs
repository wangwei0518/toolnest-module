import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
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
const backendRequire = createRequire(path.join(backendDir, 'package.json'))
const binSuffix = process.platform === 'win32' ? '.cmd' : ''
const frontendViteCommand = path.join(frontendDir, 'node_modules', '.bin', `vite${binSuffix}`)
const backendTscCommand = path.join(backendDir, 'node_modules', '.bin', `tsc${binSuffix}`)
const maxPackageFiles = positiveInteger(process.env.TOOLNEST_MODULE_MAX_FILES, 10_000)
const maxUnpackedBytes = positiveInteger(process.env.TOOLNEST_MODULE_MAX_UNPACKED_BYTES, 64 * 1024 * 1024)

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
mkdirSync(path.join(stagingDir, 'backend', 'dist'), { recursive: true })
runStep(
  '打包 Node 后端及生产依赖',
  process.execPath,
  [path.join(rootDir, 'scripts', 'bundle-backend.mjs'), path.join(backendDir, 'dist', 'main.js'), path.join(stagingDir, 'backend', 'dist', 'main.js')],
)
cpSync(path.join(backendDir, 'package.json'), path.join(stagingDir, 'backend', 'package.json'))
copySharpPlatformDependencies(path.join(stagingDir, 'backend'))
const backendPrismaDir = path.join(backendDir, 'prisma')
if (existsSync(backendPrismaDir)) cpSync(backendPrismaDir, path.join(stagingDir, 'backend', 'prisma'), { recursive: true })
console.log(`[toolnest-module] 准备发布目录：完成（${Date.now() - stagingStartedAt}ms）`)

const stagingStats = directoryStats(stagingDir)
if (stagingStats.files > maxPackageFiles) throw new Error(`发布包文件数 ${stagingStats.files} 超过限制 ${maxPackageFiles}`)
if (stagingStats.bytes > maxUnpackedBytes) throw new Error(`发布包解压体积 ${stagingStats.bytes} 超过限制 ${maxUnpackedBytes}`)
console.log(`[toolnest-module] 发布包预算：${stagingStats.files} 个文件，${formatMiB(stagingStats.bytes)} MiB / ${formatMiB(maxUnpackedBytes)} MiB`)

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

function copySharpPlatformDependencies(stagingBackendDir) {
  let sharpEntry
  try {
    sharpEntry = backendRequire.resolve('sharp')
  } catch {
    return
  }

  const sharpRoot = findPackageRoot(sharpEntry, 'sharp')
  const sharpRequire = createRequire(path.join(sharpRoot, 'package.json'))
  const sharpManifest = JSON.parse(readFileSync(path.join(sharpRoot, 'package.json'), 'utf8'))
  const runtimePlatform = `${process.platform}-${process.arch}`
  const nativePackageNames = [
    `@img/sharp-${runtimePlatform}`,
    `@img/sharp-libvips-${runtimePlatform}`,
  ].filter((name) => sharpManifest.optionalDependencies?.[name])

  if (nativePackageNames.length === 0) {
    throw new Error(`sharp 没有为当前平台 ${runtimePlatform} 声明原生可选依赖`)
  }

  const scopedPackageDir = path.join(stagingBackendDir, 'node_modules', '@img')
  mkdirSync(scopedPackageDir, { recursive: true })

  for (const packageName of nativePackageNames) {
    const entryCandidates = [`${packageName}/sharp.node`, `${packageName}/package`, packageName]
    let packageEntry
    for (const candidate of entryCandidates) {
      try {
        packageEntry = sharpRequire.resolve(candidate)
        break
      } catch {
        // Try the next exported package entry; the package root is copied below.
      }
    }
    if (!packageEntry) {
      throw new Error(
        `sharp 原生依赖 ${packageName} 未安装。请在目标平台运行 pnpm install --include=optional 后重新打包。`,
      )
    }

    const packageRoot = findPackageRoot(packageEntry, packageName)
    const packageDestination = path.join(scopedPackageDir, packageName.slice('@img/'.length))
    cpSync(realpathSync(packageRoot), packageDestination, { recursive: true })
  }

  console.log(`[toolnest-module] 已附带 sharp 原生依赖：${nativePackageNames.join(', ')}`)
}

function findPackageRoot(entryPath, expectedName) {
  let currentDir = path.dirname(realpathSync(entryPath))
  while (true) {
    const manifestPath = path.join(currentDir, 'package.json')
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      if (manifest.name === expectedName) return currentDir
    }
    const parentDir = path.dirname(currentDir)
    if (parentDir === currentDir) break
    currentDir = parentDir
  }
  throw new Error(`无法定位 ${expectedName} 的安装目录（${entryPath}）`)
}

function directoryStats(directory) {
  let files = 0
  let bytes = 0
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const itemPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      const nested = directoryStats(itemPath)
      files += nested.files
      bytes += nested.bytes
    } else if (entry.isFile()) {
      files += 1
      bytes += lstatSync(itemPath).size
    }
  }
  return { files, bytes }
}

function positiveInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

function formatMiB(bytes) {
  return (bytes / 1024 / 1024).toFixed(2)
}
