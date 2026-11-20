import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import path from 'node:path'
import process from 'node:process'
import AdmZip from '../node_modules/adm-zip/adm-zip.js'

const rootDir = process.cwd()
const modulesDir = path.join(rootDir, 'modules')
const kib = 1024
const mib = 1024 * kib
const defaultBudget = {
  initialJsGzip: 300 * kib,
  totalJsGzip: 1_100 * kib,
  cssGzip: 40 * kib,
  largestAsyncJsGzip: 800 * kib,
  packageBytes: 8 * mib,
  unpackedBytes: 16 * mib,
  packageFiles: 200,
}
const moduleBudgets = {
  // Three stripped native executables share one catalog artifact.
  'anime-calendar-react': { totalJsGzip: 160 * kib, largestAsyncJsGzip: 120 * kib, packageBytes: 18 * mib, unpackedBytes: 46 * mib },
  'python-runner': { totalJsGzip: 1_050 * kib, largestAsyncJsGzip: 800 * kib, packageBytes: 3 * mib, unpackedBytes: 8 * mib },
  'workflow-tickets-react': { totalJsGzip: 600 * kib, largestAsyncJsGzip: 200 * kib, packageBytes: 3 * mib, unpackedBytes: 8 * mib },
}
// This module deliberately embeds its full-resolution phone frame in the entry bundle.
const budgetExemptModules = new Set(['xiaomi-rear-wallpaper'])
// Served directly by the module backend, independently of the React Host entry.
const additionalFrontendEntries = { 'temporary-transfer': ['guest.js'] }
const selectedIdIndex = process.argv.indexOf('--id')
const selectedId = selectedIdIndex === -1 ? undefined : process.argv[selectedIdIndex + 1]
const targetIndex = process.argv.indexOf('--target')
const target = targetIndex === -1 ? undefined : process.argv[targetIndex + 1]
if (targetIndex !== -1 && !/^(linux\/(amd64|arm64)|windows\/amd64)$/.test(target ?? '')) throw new Error('--target 需要有效的平台目标')
if (selectedIdIndex !== -1 && (!selectedId || selectedId.startsWith('--'))) throw new Error('--id 需要模块 ID')

let failed = false
const moduleDirs = readdirSync(modulesDir)
  .map((name) => path.join(modulesDir, name))
  .filter((directory) => statSync(directory).isDirectory() && existsSync(path.join(directory, 'manifest.json')))
  .filter((directory) => !selectedId || JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8')).id === selectedId)
  .sort()
if (selectedId && !moduleDirs.length) throw new Error(`模块不存在：${selectedId}`)

for (const moduleDir of moduleDirs) {
  const manifest = JSON.parse(readFileSync(path.join(moduleDir, 'manifest.json'), 'utf8'))
  const budget = { ...defaultBudget, ...(moduleBudgets[manifest.id] ?? {}) }
  const frontendDir = path.join(moduleDir, 'frontend', 'dist')
  const entryPath = path.join(frontendDir, 'index.js')
  const entryPaths = [entryPath, ...(additionalFrontendEntries[manifest.id] ?? []).map((entry) => path.join(frontendDir, entry))]
  const suffix = target ? `-${target.replace('/', '-')}` : ''
  const packagePath = path.join(moduleDir, 'dist', `${manifest.id}-${manifest.version}${suffix}.tnmod`)
  if (entryPaths.some((entry) => !existsSync(entry)) || !existsSync(packagePath)) {
    console.error(`[budget] ${manifest.id}: 缺少当前版本构建产物或 tnmod`)
    failed = true
    continue
  }

  const allFiles = walk(frontendDir)
  const jsFiles = allFiles.filter((file) => file.endsWith('.js'))
  const cssFiles = allFiles.filter((file) => file.endsWith('.css'))
  const reachable = new Set(entryPaths.flatMap((entry) => [...dependencyClosure(entry, frontendDir, true)]))
  const entryInitials = entryPaths.map((entry) => dependencyClosure(entry, frontendDir, false))
  const initial = new Set(entryInitials.flatMap((files) => [...files]))
  const unreachable = jsFiles.filter((file) => !reachable.has(file))
  if (unreachable.length) {
    console.error(`[budget] ${manifest.id}: ${unreachable.length} 个 JS chunk 未进入入口依赖图`)
    for (const file of unreachable) console.error(`  - ${path.relative(frontendDir, file).replaceAll('\\', '/')}`)
    failed = true
  }

  // Each page loads separately; enforce the initial budget on the largest page.
  const initialJsGzip = Math.max(...entryInitials.map((files) => sumGzip([...files])))
  const totalJsGzip = sumGzip([...reachable])
  const cssGzip = sumGzip(cssFiles)
  const asyncFiles = [...reachable].filter((file) => !initial.has(file))
  const largestAsyncJsGzip = Math.max(0, ...asyncFiles.map(gzipSize))
  const archive = new AdmZip(packagePath)
  const packageEntries = archive.getEntries().filter((entry) => !entry.isDirectory)
  if (target) {
    const packaged = JSON.parse(archive.readAsText('manifest.json'))
    const expected = manifest.runtime?.executables?.[target]
    if (packaged.package_target !== target || (expected && (JSON.stringify(packaged.runtime.executables) !== JSON.stringify({ [target]: expected }) ||
      packageEntries.filter(file => file.entryName.startsWith('backend/bin/')).map(file => file.entryName).join(',') !== expected))) {
      console.error(`[budget] ${manifest.id}: 目标包清单或二进制不匹配 ${target}`)
      failed = true
    }
  }
  for (const entry of entryPaths) {
    const packageEntry = `frontend/dist/${path.relative(frontendDir, entry).replaceAll('\\', '/')}`
    if (!packageEntries.some((file) => file.entryName === packageEntry)) {
      console.error(`[budget] ${manifest.id}: tnmod 缺少入口 ${packageEntry}`)
      failed = true
    }
  }
  const unpackedBytes = packageEntries.reduce((total, entry) => total + Number(entry.header.size), 0)
  const metrics = {
    initialJsGzip,
    totalJsGzip,
    cssGzip,
    largestAsyncJsGzip,
    packageBytes: statSync(packagePath).size,
    unpackedBytes,
    packageFiles: packageEntries.length,
  }

  console.log(`[budget] ${manifest.id}@${manifest.version}`)
  if (entryPaths.length > 1) console.log(`  独立页面入口：${entryPaths.map((entry) => path.relative(frontendDir, entry)).join(', ')}；initial 按最大页面，total 按依赖并集计量`)
  if (budgetExemptModules.has(manifest.id)) {
    console.log(`  包体预算已豁免：入口 ${formatKib(initialJsGzip)}，全部 JS ${formatKib(totalJsGzip)}，ZIP ${formatMib(metrics.packageBytes)}，解包 ${formatMib(unpackedBytes)}`)
    continue
  }
  checkMetric('initial JS gzip', metrics.initialJsGzip, budget.initialJsGzip, formatKib)
  checkMetric('all reachable JS gzip', metrics.totalJsGzip, budget.totalJsGzip, formatKib)
  checkMetric('CSS gzip', metrics.cssGzip, budget.cssGzip, formatKib)
  checkMetric('largest async JS gzip', metrics.largestAsyncJsGzip, budget.largestAsyncJsGzip, formatKib)
  checkMetric('tnmod ZIP', metrics.packageBytes, budget.packageBytes, formatMib)
  checkMetric('tnmod unpacked', metrics.unpackedBytes, budget.unpackedBytes, formatMib)
  checkMetric('tnmod files', metrics.packageFiles, budget.packageFiles, String)
}

if (failed) process.exitCode = 1

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(target) : entry.isFile() ? [target] : []
  })
}

function dependencyClosure(entryPath, frontendDir, includeDynamic) {
  const pending = [entryPath]
  const visited = new Set()
  while (pending.length) {
    const current = pending.pop()
    if (!current || visited.has(current)) continue
    visited.add(current)
    const source = readFileSync(current, 'utf8')
    for (const specifier of imports(source, includeDynamic)) {
      if (!specifier.startsWith('.') && !specifier.startsWith('/')) continue
      const target = specifier.startsWith('/')
        ? path.resolve(frontendDir, `.${specifier}`)
        : path.resolve(path.dirname(current), specifier)
      if (target.startsWith(frontendDir) && existsSync(target) && target.endsWith('.js')) pending.push(target)
    }
  }
  return visited
}

function imports(source, includeDynamic) {
  const values = []
  const staticPattern = /\b(?:from\s*|import\s*)["']([^"']+)["']/g
  const dynamicPattern = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
  const workerPattern = /\bnew\s+URL\s*\(\s*["']([^"']+\.js)["']\s*,\s*import\.meta\.url\s*\)/g
  const workerPathPattern = /\bnew\s+Worker\s*\(\s*["']([^"']+\.js)["']/g
  for (const match of source.matchAll(staticPattern)) values.push(match[1])
  if (includeDynamic) {
    for (const match of source.matchAll(dynamicPattern)) values.push(match[1])
    for (const match of source.matchAll(workerPattern)) values.push(match[1])
    for (const match of source.matchAll(workerPathPattern)) values.push(match[1])
  }
  return values
}

function gzipSize(file) {
  return gzipSync(readFileSync(file), { level: 9 }).length
}

function sumGzip(files) {
  return files.reduce((total, file) => total + gzipSize(file), 0)
}

function checkMetric(label, value, limit, formatter) {
  const ok = value <= limit
  console.log(`  ${label}: ${formatter(value)} / ${formatter(limit)} (${ok ? '通过' : '超限'})`)
  if (!ok) failed = true
}

function formatKib(value) { return `${(value / kib).toFixed(1)} KiB` }
function formatMib(value) { return `${(value / mib).toFixed(2)} MiB` }
