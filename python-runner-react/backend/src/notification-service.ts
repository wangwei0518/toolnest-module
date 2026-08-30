import { config } from './config.js'

export interface NotificationConfig {
  notify_on_failure: boolean
  failure_threshold_enabled: boolean
  failure_threshold: number
  notify_on_success: boolean
  notify_on_recovered: boolean
  forward_output_on_success: boolean
  output_mode: 'summary' | 'stdout' | 'stderr' | 'both'
  max_lines: number
  max_chars: number
  notify_when_empty_output: boolean
  channels: 'default' | 'custom'
  custom_channels: string[]
  email_recipients: string[]
}

export interface ExecutionNotificationInput {
  id: string
  name: string
  status: string
  stdout: string
  stderr: string
  exit_code: number | null
  duration_ms: number | null
}

const DEFAULT_CONFIG: NotificationConfig = {
  notify_on_failure: true,
  failure_threshold_enabled: true,
  failure_threshold: 3,
  notify_on_success: false,
  notify_on_recovered: false,
  forward_output_on_success: false,
  output_mode: 'stdout',
  max_lines: 100,
  max_chars: 4000,
  notify_when_empty_output: false,
  channels: 'default',
  custom_channels: [],
  email_recipients: [],
}

const ALLOWED_CHANNELS = new Set(['web_internal', 'qqbot', 'email', 'webhook'])

export function normalizeNotificationConfig(value: unknown): NotificationConfig {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const outputMode = input.output_mode === 'summary' || input.output_mode === 'stderr' || input.output_mode === 'both' ? input.output_mode : 'stdout'
  const channels = input.channels === 'custom' ? 'custom' : 'default'
  const customChannels = Array.isArray(input.custom_channels)
    ? [...new Set(input.custom_channels.filter((item): item is string => typeof item === 'string').map((item) => item.trim().toLowerCase()).filter((item) => ALLOWED_CHANNELS.has(item)))]
    : []
  const emailRecipients = Array.isArray(input.email_recipients)
    ? [...new Set(input.email_recipients.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))]
    : []
  return {
    ...DEFAULT_CONFIG,
    notify_on_failure: input.notify_on_failure !== false,
    failure_threshold_enabled: input.failure_threshold_enabled !== false,
    failure_threshold: clampInteger(input.failure_threshold, 3, 1, 100),
    notify_on_success: input.notify_on_success === true,
    notify_on_recovered: input.notify_on_recovered === true,
    forward_output_on_success: input.forward_output_on_success === true,
    output_mode: outputMode,
    max_lines: clampInteger(input.max_lines, 100, 1, 500),
    max_chars: clampInteger(input.max_chars, 4000, 100, 20_000),
    notify_when_empty_output: input.notify_when_empty_output === true,
    channels,
    custom_channels: customChannels,
    email_recipients: emailRecipients,
  }
}

export class NotificationService {
  private readonly endpoint: string | null

  constructor() {
    const base = process.env.TOOLNEST_PLUGIN_PLATFORM_API_URL?.trim()
    this.endpoint = base ? `${base.replace(/\/$/, '')}/internal/modules/${encodeURIComponent(config.moduleId)}/notifications` : null
  }

  async notifyExecution(execution: ExecutionNotificationInput, rawConfig: unknown, recovered = false): Promise<void> {
    if (!this.endpoint) return
    const notificationConfig = normalizeNotificationConfig(rawConfig)
    const failed = execution.status === 'failed' || execution.status === 'timeout'
    const success = execution.status === 'success'
    if (failed && !notificationConfig.notify_on_failure) return
    if (success && !notificationConfig.notify_on_success && !notificationConfig.forward_output_on_success && !(recovered && notificationConfig.notify_on_recovered)) return
    if (!failed && !success) return

    let content = failed
      ? tail(execution.stderr || execution.stdout || '无错误输出', notificationConfig.max_lines, notificationConfig.max_chars)
      : notificationContent(execution, notificationConfig)
    content = sanitizeNotificationText(content)
    if (success && !content.trim() && notificationConfig.forward_output_on_success && !notificationConfig.notify_when_empty_output && !notificationConfig.notify_on_success) return
    if (success && !content.trim()) content = '无输出'

    await this.send({
      event_type: failed ? 'execution_failed' : 'execution_success',
      level: failed ? 'error' : 'success',
      title: failed ? `Python 任务执行失败：${execution.name}` : `Python 任务执行成功：${execution.name}`,
      summary: '',
      content,
      source_type: 'execution',
      source_id: execution.id,
      channels: notificationConfig.channels === 'custom' ? notificationConfig.custom_channels : undefined,
      email_recipients: notificationConfig.email_recipients,
    })
  }

  async send(input: { event_type: string; level: string; title: string; summary?: string; content?: string; source_type?: string; source_id?: string; related_url?: string | null; channels?: string[]; email_recipients?: string[] }): Promise<void> {
    if (!this.endpoint) return
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5_000)
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8', 'x-toolnest-internal-token': config.token },
        body: JSON.stringify({ ...input, module_id: config.moduleId }),
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`平台通知接口返回 HTTP ${response.status}`)
    } catch {
      // Notification delivery must never change the task result.
    } finally {
      clearTimeout(timeout)
    }
  }
}

function notificationContent(execution: ExecutionNotificationInput, config: NotificationConfig): string {
  if (config.output_mode === 'summary') return `任务：${execution.name}\n状态：${execution.status}\n耗时：${execution.duration_ms ?? 0} ms`
  if (config.output_mode === 'stderr') return tail(execution.stderr, config.max_lines, config.max_chars)
  if (config.output_mode === 'both') return tail(`stdout:\n${execution.stdout}\n\nstderr:\n${execution.stderr}`, config.max_lines, config.max_chars)
  return tail(execution.stdout, config.max_lines, config.max_chars)
}

function tail(value: string, maxLines: number, maxChars: number): string {
  const lines = value.split(/\r?\n/)
  const text = lines.slice(-maxLines).join('\n')
  return text.length > maxChars ? text.slice(-maxChars) : text
}

function sanitizeNotificationText(value: string): string {
  return value
    .replace(/((?:password|passwd|secret|token|api[_-]?key|authorization|private[_-]?key)\s*[:=]\s*)([^\s,;]+)/gi, '$1********')
    .replace(/(postgres(?:ql)?:\/\/[^\s:/]+:)[^@\s]+(@)/gi, '$1********$2')
    .replace(/(https?:\/\/[^\s:/]+:)[^@\s]+(@)/gi, '$1********$2')
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback
  return Math.min(max, Math.max(min, number))
}
