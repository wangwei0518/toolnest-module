import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const rootDir = process.cwd()
const repository = process.env.GITHUB_REPOSITORY ?? 'wangwei0518/toolnest-module'
const releaseTag = process.env.RELEASE_TAG ?? 'main'
const outputFile = process.env.CATALOG_OUTPUT ?? path.join(rootDir, 'catalog.json')
const modulesDir = path.join(rootDir, 'modules')

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'))
}

function hashFile(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

const modules = []
for (const id of readdirSync(modulesDir).sort()) {
  const moduleDir = path.join(modulesDir, id)
  if (!statSync(moduleDir).isDirectory()) continue
  const manifest = readJson(path.join(moduleDir, 'manifest.json'))
  const packageName = `${manifest.id}-${manifest.version}.tnmod`
  const packagePath = path.join(moduleDir, 'dist', packageName)
  const packageUrl = `https://github.com/${repository}/releases/download/${releaseTag}/${packageName}`
  const packageStats = statSync(packagePath)
  modules.push({
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description ?? '',
    author: manifest.author ?? 'ToolNest',
    icon: manifest.icon ?? 'cube',
    minimum_core_version: manifest.minimum_core_version ?? '>=0.1.0',
    release_notes: `由 ${releaseTag} 发布。`,
    tags: ['ToolNest', '模块'],
    published_at: new Date().toISOString(),
    package: {
      url: packageUrl,
      sha256: hashFile(packagePath),
      size_bytes: packageStats.size,
    },
  })
}

const catalog = {
  schema_version: 1,
  name: 'ToolNest 官方模块目录',
  modules,
}
writeFileSync(outputFile, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8')
console.log(`已生成 ${path.relative(rootDir, outputFile)}，包含 ${modules.length} 个模块版本。`)
