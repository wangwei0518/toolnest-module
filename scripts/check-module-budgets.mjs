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
  'anime-calendar-react': { totalJsGzip: 160 * kib, largestAsyncJsGzip: 120 * kib, packageBytes: 3 * mib, unpackedBytes: 6 * mib },
  'python-runner': { totalJsGzip: 1_050 * kib, largestAsyncJsGzip: 800 * kib, packageBytes: 3 * mib, unpackedBytes: 8 * mib },
  'workflow-tickets-react': { totalJsGzip: 600 * kib, largestAsyncJsGzip: 200 * kib, packageBytes: 3 * mib, unpackedBytes: 8 * mib },
}

let failed = false
const moduleDirs = readdirSync(modulesDir)
  .map((name) => path.join(modulesDir, name))
  .filter((directory) => statSync(directory).isDirectory() && existsSync(path.join(directory, 'manifest.json')))
  .sort()

for (const moduleDir of moduleDirs) {
  const manifest = JSON.parse(readFileSync(path.join(moduleDir, 'manifest.json'), 'utf8'))
  const budget = { ...defaultBudget, ...(moduleBudgets[manifest.id] ?? {}) }
  const frontendDir = path.join(moduleDir, 'frontend', 'dist')
  const entryPath = path.join(frontendDir, 'index.js')
  const packagePath = path.join(moduleDir, 'dist', `${manifest.id}-${manifest.version}.tnmod`)
  if (!existsSync(entryPath) || !existsSync(packagePath)) {
    console.error(`[budget] ${manifest.id}: 缺少当前版本构建产物或 tnmod`)
    failed = true
    continue
  }

  const allFiles = walk(frontendDir)
  const jsFiles = allFiles.filter((file) => file.endsWith('.js'))
  const cssFiles = allFiles.filter((file) => file.endsWith('.css'))
  const reachable = dependencyClosure(entryPath, frontendDir, true)
  const initial = dependencyClosure(entryPath, frontendDir, false)
  const unreachable = jsFiles.filter((file) => !reachable.has(file))
  if (unreachable.length) {
    console.error(`[budget] ${manifest.id}: ${unreachable.length} 个 JS chunk 未进入入口依赖图`)
    for (const file of unreachable) console.error(`  - ${path.relative(frontendDir, file).replaceAll('\\', '/')}`)
    failed = true
  }

  const initialJsGzip = sumGzip([...initial])
  const totalJsGzip = sumGzip([...reachable])
  const cssGzip = sumGzip(cssFiles)
  const asyncFiles = [...reachable].filter((file) => !initial.has(file))
  const largestAsyncJsGzip = Math.max(0, ...asyncFiles.map(gzipSize))
  const archive = new AdmZip(packagePath)
  const packageEntries = archive.getEntries().filter((entry) => !entry.isDirectory)
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
