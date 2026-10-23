import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Pool } from 'pg'

// Fixed key so concurrent cp-api starts serialize on the same advisory lock.
const MIGRATION_LOCK_ID = 7_340_001
const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url))

/** Applies migrations/*.sql in filename order, once each. Returns the names applied this run. */
export async function migrate(pool: Pool, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
  const client = await pool.connect()
  const applied: string[] = []
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID])
    await client.query(
      'CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())'
    )
    const done = new Set(
      (await client.query<{ name: string }>('SELECT name FROM _migrations')).rows.map((r) => r.name)
    )
    for (const name of files.filter((f) => !done.has(f))) {
      const sql = await readFile(`${dir}/${name}`, 'utf8')
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [name])
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      }
      applied.push(name)
    }
    return applied
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => undefined)
    client.release()
  }
}
