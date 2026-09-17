import path from 'node:path'

function numberEnv(name: string, fallback: number, min: number, max: number): number {
  const value = process.env[name]
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} must be an integer between ${min} and ${max}`)
  return parsed
}

const dataDir = process.env.TOOLNEST_PLUGIN_DATA_DIR
const logDir = process.env.TOOLNEST_PLUGIN_LOG_DIR
const token = process.env.TOOLNEST_PLUGIN_TOKEN
const databaseUrl = process.env.TOOLNEST_PLUGIN_DATABASE_URL
const databaseSchema = process.env.TOOLNEST_PLUGIN_DATABASE_SCHEMA ?? 'public'

if (!dataDir) throw new Error('TOOLNEST_PLUGIN_DATA_DIR is required')
if (!logDir) throw new Error('TOOLNEST_PLUGIN_LOG_DIR is required')
if (!token) throw new Error('TOOLNEST_PLUGIN_TOKEN is required')
if (!databaseUrl) throw new Error('TOOLNEST_PLUGIN_DATABASE_URL is required')
if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(databaseSchema)) throw new Error('TOOLNEST_PLUGIN_DATABASE_SCHEMA must be a valid PostgreSQL schema name')

export const config = {
  moduleId: process.env.TOOLNEST_PLUGIN_ID ?? 'python-runner',
  releaseId: process.env.TOOLNEST_PLUGIN_RELEASE_ID ?? 'development',
  port: numberEnv('TOOLNEST_PLUGIN_PORT', 0, 0, 65_535),
  token,
  databaseUrl,
  databaseSchema,
  dataDir: path.resolve(dataDir),
  logDir: path.resolve(logDir),
  pythonExecutable: process.env.PYTHON_EXECUTABLE ?? (process.platform === 'win32' ? 'python' : 'python3'),
  maxOutputBytes: numberEnv('PYTHON_RUNNER_MAX_OUTPUT_BYTES', 5 * 1024 * 1024, 1_024, 50 * 1024 * 1024),
  maxExecutionSeconds: numberEnv('PYTHON_RUNNER_MAX_EXECUTION_SECONDS', 600, 1, 3_600),
  maxConcurrentExecutions: numberEnv('PYTHON_RUNNER_MAX_CONCURRENT_EXECUTIONS', 4, 1, 32),
}
