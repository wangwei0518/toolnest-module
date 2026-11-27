import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const repository = process.env.GITHUB_REPOSITORY ?? 'wangwei0518/toolnest-module'
const releaseTag = process.env.RELEASE_TAG
if (!releaseTag) throw new Error('缺少 RELEASE_TAG')
const output = process.env.CATALOG_OUTPUT ?? 'catalog.json'
const plan = readJson('module-release-plan.json')
const previous = readJson(existsSync(output) ? output : 'catalog.json')
const modules = new Map(previous.modules.map(item => [item.id, item]))

for (const { id, dir, version, targets } of plan) {
  const manifest = readJson(path.join('modules', dir, 'manifest.json'))
  if (manifest.id !== id || manifest.version !== version) throw new Error('构建清单版本与源码不同')
  const entry = {
    id, name: manifest.name, version,
    description: manifest.description ?? '',
    author: manifest.author ?? 'ToolNest',
    icon: manifest.icon ?? 'cube',
    minimum_core_version: manifest.minimum_core_version ?? '>=0.1.0',
    release_notes: `由 ${releaseTag} 发布。`,
    tags: ['ToolNest', '模块'],
    published_at: new Date().toISOString(),
  }
  if (targets.length) entry.packages = Object.fromEntries(targets.map(target => [target, packageInfo(id, version, target)]))
  else entry.package = packageInfo(id, version)
  modules.set(id, entry)
}
writeFileSync(output, JSON.stringify({ schema_version: 2, name: previous.name, modules: [...modules.values()].sort((a, b) => a.id.localeCompare(b.id)) }, null, 2) + '\n')

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function packageInfo(id, version, target) {
  const filename = `${id}-${version}${target ? '-' + target.replace('/', '-') : ''}.tnmod`
  const file = path.join('release-assets', filename)
  const size = statSync(file).size
  if (size < 1 || size > 256 * 1024 * 1024) throw new Error(`包大小无效：${filename}`)
  return {
    url: `https://github.com/${repository}/releases/download/${encodeURIComponent(releaseTag)}/${filename}`,
    sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
    size_bytes: size,
  }
}
