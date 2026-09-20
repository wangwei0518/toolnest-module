import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Database } from './db.js'
import { ProjectService } from './project-service.js'

const RISK_ORDER: Record<string, number> = { low: 1, medium: 2, high: 3, blocked: 4 }
const REQUIREMENT_RULES: Array<[string, string, string]> = [
  ['file://', 'blocked', '禁止从本地文件 URL 安装依赖。'],
  ['../', 'blocked', '禁止 requirements.txt 引用项目外路径。'],
  ['-e', 'high', '可编辑安装会执行外部构建逻辑，请确认来源可信。'],
  ['--editable', 'high', '可编辑安装会执行外部构建逻辑，请确认来源可信。'],
  ['git+', 'high', 'Git 依赖会从远程仓库拉取代码，请确认来源可信。'],
  ['http://', 'high', '明文 HTTP 依赖源存在被篡改风险。'],
  ['--index-url', 'high', '自定义依赖源会改变安装来源，请确认可信。'],
  ['--extra-index-url', 'high', '额外依赖源会改变安装来源，请确认可信。'],
  ['--trusted-host', 'medium', 'trusted-host 会降低 pip TLS 校验要求。'],
  ['--pre', 'medium', '预发布版本稳定性和安全性需要额外确认。'],
  ['https://', 'medium', '直接 URL 依赖需要确认来源可信。'],
]
const SOURCE_RULES: Array<[RegExp, string, string, string]> = [
  [/\bos\.remove\s*\(/, 'high', 'filesystem', '会删除文件，请确认脚本只操作项目目录。'],
  [/\bos\.rmdir\s*\(/, 'high', 'filesystem', '会删除目录，请确认脚本只操作项目目录。'],
  [/\bshutil\.rmtree\s*\(/, 'high', 'filesystem', '会递归删除目录，请确认目标路径。'],
  [/\bsubprocess\b/, 'high', 'subprocess', '会启动外部进程，请确认命令来源和参数可信。'],
  [/\bos\.system\s*\(/, 'high', 'subprocess', '会通过系统命令执行，请确认命令来源可信。'],
  [/\bsocket\b/, 'medium', 'network', '会访问网络或监听端口，请确认目标可信。'],
  [/\b(requests|urllib|httpx|aiohttp)\b/, 'medium', 'network', '会访问网络，请确认目标可信。'],
  [/\b(paramiko|ftplib|smtplib)\b/, 'high', 'network', '会建立远程连接，请确认凭据和目标可信。'],
  [/\beval\s*\(/, 'high', 'dynamic', '会动态执行表达式，请确认输入不可被外部控制。'],
  [/\bexec\s*\(/, 'high', 'dynamic', '会动态执行代码，请确认来源可信。'],
  [/\b(__import__|importlib\.import_module)\s*\(/, 'medium', 'dynamic', '会动态导入模块，请确认模块来源可信。'],
  [/\bos\.(environ|getenv)\b/, 'medium', 'environment', '会读取环境变量，运行环境只注入受控变量。'],
  [/\b(ctypes|pickle\.loads?|marshal)\b/, 'high', 'serialization', '可能执行底层调用或不安全反序列化。'],
  [/\b(schtasks|systemd|crontab|startup)\b/i, 'high', 'persistence', '可能修改系统计划任务或自启动配置。'],
]
const SENSITIVE_NAMES = new Set(['.env', '.env.local', '.env.production', 'credentials.json', 'token.json', 'secret.json', 'id_rsa', 'id_ed25519'])

export interface SecurityFinding {
  id: string
  level: string
  category: string
  file: string
  line: number | null
  message: string
  suggestion: string
  token?: string
  content?: string
}

export interface SecurityScan {
  runner_mode: string
  security_mode: string
  scan_id: string
  risk_level: string
  summary: Record<string, number>
  findings: SecurityFinding[]
  scanned_at: string
  message: string
}

export class SecurityError extends Error {
  readonly statusCode = 409
  constructor(readonly security: SecurityScan, action: string) {
    super(`${action}前需要确认当前安全扫描风险。`)
    this.name = 'SecurityError'
  }
}

export class SecurityService {
  constructor(private readonly db: Database, private readonly projects: ProjectService) {}

  async scanProject(projectId: string): Promise<SecurityScan> {
    const project = await this.projects.get(projectId)
    const findings: SecurityFinding[] = []
    for (const relative of project.metadata.file_tree.flatMap((node) => flattenTree(node))) {
      const name = path.basename(relative).toLowerCase()
      if (SENSITIVE_NAMES.has(name) || /\.(pem|key|p12|pfx)$/i.test(name)) {
        findings.push(makeFinding('high', 'sensitive_file', relative, null, '项目中包含疑似敏感文件。', '请移除密钥、令牌或生产环境配置。'))
      }
    }
    for (const relative of project.metadata.python_files.slice(0, 500)) {
      const filePath = path.join(project.sourceRoot, relative)
      const source = await readFile(filePath, 'utf8').catch(() => '')
      if (Buffer.byteLength(source, 'utf8') > 1024 * 1024) {
        findings.push(makeFinding('medium', 'source', relative, null, 'Python 文件超过 1 MB，已跳过深度扫描。', '请人工确认该文件来源可信。'))
        continue
      }
      findings.push(...scanText(source, relative))
    }
    for (const relative of project.metadata.dependency_files.filter((file) => path.basename(file).toLowerCase() === 'requirements.txt')) {
      const content = await readFile(path.join(project.sourceRoot, relative), 'utf8').catch(() => '')
      content.split(/\r?\n/).forEach((line, index) => {
        const lower = line.trim().toLowerCase()
        if (!lower || lower.startsWith('#')) return
        const rule = REQUIREMENT_RULES.find(([token]) => lower.includes(token))
        if (rule) findings.push(makeFinding(rule[1], 'requirements', relative, index + 1, `requirements.txt 包含风险依赖声明：${rule[0]}`, rule[2], rule[0], line.trim()))
      })
    }
    const riskLevel = findings.reduce((max, finding) => (RISK_ORDER[finding.level] ?? 0) > (RISK_ORDER[max] ?? 0) ? finding.level : max, 'low')
    const summary = Object.fromEntries(['low', 'medium', 'high', 'blocked'].map((level) => [level, findings.filter((finding) => finding.level === level).length]))
    const scanId = `${createHash('sha256').update(`${projectId}:${project.row.source_hash ?? ''}:${JSON.stringify(findings)}`).digest('hex').slice(0, 12)}-${Date.now().toString(36)}`
    const scan: SecurityScan = {
      runner_mode: 'local_venv',
      security_mode: 'guarded',
      scan_id: scanId,
      risk_level: riskLevel,
      summary,
      findings,
      scanned_at: new Date().toISOString(),
      message: riskLevel === 'blocked' ? '发现阻断风险，当前项目不可执行。' : riskLevel === 'high' ? '发现高风险项，仅运行可信项目并确认风险。' : riskLevel === 'medium' ? '发现中等风险项，运行前需要确认。' : '未发现明显风险。',
    }
    await this.db.transaction(async (client) => {
      await client.query('INSERT INTO pr_security_scans (id, project_id, source_hash, risk_level, summary, message, scanned_at) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)', [scanId, projectId, project.row.source_hash ?? '', riskLevel, JSON.stringify(summary), scan.message, scan.scanned_at])
      if (findings.length > 0) {
        await client.query(
          `INSERT INTO pr_security_findings (id, scan_id, level, category, file, line, message, suggestion, token, content)
           SELECT finding.id, $1, finding.level, finding.category, finding.file, finding.line, finding.message, finding.suggestion, finding.token, finding.content
           FROM UNNEST($2::text[], $3::text[], $4::text[], $5::text[], $6::integer[], $7::text[], $8::text[], $9::text[], $10::text[])
             AS finding(id, level, category, file, line, message, suggestion, token, content)`,
          [
            scanId,
            findings.map((finding) => finding.id),
            findings.map((finding) => finding.level),
            findings.map((finding) => finding.category),
            findings.map((finding) => finding.file),
            findings.map((finding) => finding.line),
            findings.map((finding) => finding.message),
            findings.map((finding) => finding.suggestion),
            findings.map((finding) => finding.token ?? null),
            findings.map((finding) => finding.content ?? null),
          ],
        )
      }
    })
    return scan
  }

  async getProjectSecurity(projectId: string): Promise<SecurityScan> {
    const project = await this.projects.get(projectId)
    const result = await this.db.query<ScanRow>('SELECT * FROM pr_security_scans WHERE project_id = $1 AND source_hash = $2 ORDER BY scanned_at DESC LIMIT 1', [projectId, project.row.source_hash ?? ''])
    if (!result.rows[0]) return this.scanProject(projectId)
    return this.readScan(result.rows[0])
  }

  async findings(projectId: string): Promise<SecurityFinding[]> {
    return (await this.getProjectSecurity(projectId)).findings
  }

  async requireProjectConfirmation(projectId: string, confirmation: unknown, action: string): Promise<SecurityScan> {
    const scan = await this.getProjectSecurity(projectId)
    if (scan.risk_level === 'blocked') throw new SecurityError(scan, action)
    const payload = confirmation && typeof confirmation === 'object' ? confirmation as Record<string, unknown> : {}
    const confirmed = payload.risk_confirmed === true && payload.scan_id === scan.scan_id
    if ((scan.risk_level === 'medium' || scan.risk_level === 'high') && !confirmed) throw new SecurityError(scan, action)
    return scan
  }

  scanInline(code: string): SecurityScan {
    const findings = scanText(code, 'main.py')
    const riskLevel = findings.reduce((max, finding) => (RISK_ORDER[finding.level] ?? 0) > (RISK_ORDER[max] ?? 0) ? finding.level : max, 'low')
    const summary = Object.fromEntries(['low', 'medium', 'high', 'blocked'].map((level) => [level, findings.filter((finding) => finding.level === level).length]))
    const scanId = createHash('sha256').update(JSON.stringify(findings)).digest('hex').slice(0, 16)
    return { runner_mode: 'system_python', security_mode: 'guarded', scan_id: scanId, risk_level: riskLevel, summary, findings, scanned_at: new Date().toISOString(), message: riskLevel === 'high' ? '发现高风险项，运行前需要确认。' : '未发现明显风险。' }
  }

  requireInlineConfirmation(code: string, confirmation: unknown, action: string): SecurityScan {
    const scan = this.scanInline(code)
    if (scan.risk_level === 'blocked') throw new SecurityError(scan, action)
    if ((scan.risk_level === 'medium' || scan.risk_level === 'high') && !isConfirmed(confirmation, scan.scan_id)) throw new SecurityError(scan, action)
    return scan
  }

  private async readScan(row: ScanRow): Promise<SecurityScan> {
    const findings = await this.db.query<SecurityFinding>('SELECT id, level, category, file, line, message, suggestion, token, content FROM pr_security_findings WHERE scan_id = $1 ORDER BY file, line NULLS LAST', [row.id])
    return { runner_mode: 'local_venv', security_mode: 'guarded', scan_id: row.id, risk_level: row.risk_level, summary: row.summary ?? {}, findings: findings.rows, scanned_at: new Date(row.scanned_at).toISOString(), message: row.message }
  }

}

function scanText(source: string, file: string): SecurityFinding[] {
  const findings: SecurityFinding[] = []
  source.split(/\r?\n/).forEach((line, index) => {
    for (const [pattern, level, category, suggestion] of SOURCE_RULES) {
      if (pattern.test(line)) {
        findings.push(makeFinding(level, category, file, index + 1, `发现潜在风险代码：${line.trim().slice(0, 120)}`, suggestion))
      }
    }
  })
  return findings
}

function makeFinding(level: string, category: string, file: string, line: number | null, message: string, suggestion: string, token?: string, content?: string): SecurityFinding {
  const id = createHash('sha256').update(`${level}:${category}:${file}:${line}:${message}:${suggestion}:${token ?? ''}`).digest('hex').slice(0, 12)
  return { id, level, category, file, line, message, suggestion, ...(token ? { token } : {}), ...(content ? { content } : {}) }
}

function isConfirmed(value: unknown, scanId: string): boolean { return Boolean(value && typeof value === 'object' && (value as Record<string, unknown>).risk_confirmed === true && (value as Record<string, unknown>).scan_id === scanId) }

function flattenTree(node: { path: string; type: string; children?: Array<{ path: string; type: string; children?: unknown[] }> }): string[] {
  if (node.type === 'file') return [node.path]
  return (node.children ?? []).flatMap((child) => flattenTree(child as { path: string; type: string; children?: Array<{ path: string; type: string; children?: unknown[] }> }))
}

interface ScanRow {
  id: string
  risk_level: string
  summary: Record<string, number> | null
  message: string
  scanned_at: Date | string
}
