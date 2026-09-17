import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let server: Server
let port = 0
let received: Record<string, unknown> | null = null
let NotificationService: typeof import('../src/notification-service.js').NotificationService

describe('module notification bridge', () => {
  beforeAll(async () => {
    process.env.TOOLNEST_PLUGIN_ID = 'python-runner'
    process.env.TOOLNEST_PLUGIN_RELEASE_ID = 'notification-test'
    process.env.TOOLNEST_PLUGIN_PORT = '0'
    process.env.TOOLNEST_PLUGIN_TOKEN = 'notification-test-token'
    process.env.TOOLNEST_PLUGIN_DATA_DIR = 'notification-test-data'
    process.env.TOOLNEST_PLUGIN_LOG_DIR = 'notification-test-logs'
    process.env.TOOLNEST_PLUGIN_DATABASE_URL = 'postgresql://toolnest:toolnest@127.0.0.1:5432/toolnest_react'
    server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        received = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
        response.writeHead(202)
        response.end('{}')
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as { port: number }).port
    process.env.TOOLNEST_PLUGIN_PLATFORM_API_URL = `http://127.0.0.1:${port}/api/v1`
    NotificationService = (await import('../src/notification-service.js')).NotificationService
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('sends a bounded execution notification to the host bridge', async () => {
    const service = new NotificationService()
    await service.notifyExecution({ id: 'exec-1', name: '通知测试', status: 'success', stdout: 'done', stderr: '', exit_code: 0, duration_ms: 12 }, { notify_on_success: true, channels: 'custom', custom_channels: ['web_internal'] })
    expect(received).toMatchObject({ module_id: 'python-runner', event_type: 'execution_success', source_id: 'exec-1', content: 'done', channels: ['web_internal'] })
  })

  it('does not let a host bridge failure change the task path', async () => {
    process.env.TOOLNEST_PLUGIN_PLATFORM_API_URL = 'http://127.0.0.1:1/api/v1'
    const service = new NotificationService()
    await service.send({ event_type: 'execution_failed', level: 'error', title: 'failure', content: 'error' })
    expect(true).toBe(true)
  })
})
