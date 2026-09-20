import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool, type PoolClient, type QueryResultRow } from 'pg'

export class Database {
  readonly pool: Pool
  private readonly databaseSchema: string

  constructor(databaseUrl: string, databaseSchema = 'public', poolMax = 2) {
    this.databaseSchema = databaseSchema
    this.pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${databaseSchema}`, max: poolMax, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 })
  }

  async migrate(): Promise<void> {
    const client = await this.pool.connect()
    try {
      const schema = `"${this.databaseSchema.replaceAll('"', '""')}"`
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`)
      await client.query(`SET search_path TO ${schema}`)
      await client.query('BEGIN')
      await client.query('CREATE TABLE IF NOT EXISTS pr_schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())')
      const migrationPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../prisma/migrations/001_python_runner_init.sql')
      const migration = await readFile(migrationPath, 'utf8')
      const version = '001_python_runner_init'
      const existing = await client.query<{ version: string }>('SELECT version FROM pr_schema_migrations WHERE version = $1', [version])
      if (existing.rowCount === 0) {
        await client.query(migration)
        await client.query('INSERT INTO pr_schema_migrations(version) VALUES ($1)', [version])
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []): Promise<{ rows: T[]; rowCount: number }> {
    const result = await this.pool.query<T>(text, values)
    return { rows: result.rows, rowCount: result.rowCount ?? 0 }
  }

  async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await callback(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
