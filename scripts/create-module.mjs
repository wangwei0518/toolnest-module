import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const rootDir = process.cwd()
const templateDir = path.join(rootDir, 'templates', 'module')
const modulesDir = path.join(rootDir, 'modules')
const moduleIdPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

function parseArgs(argv) {
  const result = { id: '', name: '', description: '', version: '0.1.0' }
  const positional = []
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--id') result.id = argv[++index] ?? ''
    else if (value === '--name') result.name = argv[++index] ?? ''
    else if (value === '--description') result.description = argv[++index] ?? ''
    else if (value === '--version') result.version = argv[++index] ?? ''
    else positional.push(value)
  }
  if (!result.id && positional[0]) result.id = positional[0]
  if (!result.name && positional[1]) result.name = positional[1]
  if (!result.description) result.description = result.name ? `${result.name} 模块` : ''
  return result
}

function buildReplacements(options) {
  return {
    MODULE_ID: options.id,
    MODULE_NAME: options.name,
    MODULE_DESCRIPTION: options.description,
    MODULE_VERSION: options.version,
    MODULE_PERMISSION_PREFIX: options.id.replaceAll('-', '.'),
  }
}

function replacePlaceholders(content, replacements) {
  return content.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) => replacements[key] ?? match)
}

async function pathExists(target) {
  try {
    await stat(target)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function copyTemplate(source, target, replacements) {
  const sourceStat = await stat(source)
  if (sourceStat.isDirectory()) {
    await mkdir(target, { recursive: true })
    for (const entry of await readdir(source)) {
      await copyTemplate(path.join(source, entry), path.join(target, entry), replacements)
    }
    return
  }
  const content = await readFile(source, 'utf8')
  await writeFile(target, replacePlaceholders(content, replacements), 'utf8')
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!options.id || !options.name) {
    throw new Error('请提供模块 ID 和名称，例如：pnpm create:module --id demo-module --name 示例模块')
  }
  if (!moduleIdPattern.test(options.id)) throw new Error('模块 ID 必须是 kebab-case，例如 demo-module')
  if (!(await pathExists(templateDir))) throw new Error('模板目录不存在：templates/module')

  const targetDir = path.join(modulesDir, options.id)
  if (await pathExists(targetDir)) throw new Error(`目标模块目录已存在：${path.relative(rootDir, targetDir)}`)
  await copyTemplate(templateDir, targetDir, buildReplacements(options))

  console.log(`模块 ${options.id} 已创建。`)
  console.log('')
  console.log('下一步：')
  console.log(`1. pnpm --dir modules/${options.id}/frontend install`)
  console.log(`2. pnpm --dir modules/${options.id}/frontend typecheck`)
  console.log(`3. pnpm --dir modules/${options.id}/frontend build`)
  console.log(`4. pnpm --dir modules/${options.id}/backend install`)
  console.log(`5. pnpm --dir modules/${options.id}/backend typecheck`)
  console.log(`6. pnpm package:module -- --id ${options.id}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
