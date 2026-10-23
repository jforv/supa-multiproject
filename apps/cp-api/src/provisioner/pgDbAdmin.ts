import type { Pool } from 'pg'

import type { ProjectDbAdmin } from './ports.js'

const SAFE_DB_NAME = /^[a-z0-9_]{1,63}$/
const PG_DUPLICATE_DATABASE = '42P04'

function quoted(dbName: string): string {
  // CREATE/DROP DATABASE take identifiers, not parameters, so the name is validated, not escaped.
  if (!SAFE_DB_NAME.test(dbName)) throw new Error(`Refusing unsafe database name "${dbName}"`)
  return `"${dbName}"`
}

/** Creates and drops project databases through a pool connected to the maintenance database. */
export function createPgDbAdmin(pool: Pool): ProjectDbAdmin {
  return {
    async createDatabase(dbName) {
      const ident = quoted(dbName)
      const { rowCount } = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [
        dbName,
      ])
      if (rowCount) return
      try {
        await pool.query(`CREATE DATABASE ${ident}`)
      } catch (err) {
        // Lost a race with a retry of the same job: the database exists, which is the goal.
        if ((err as { code?: string }).code !== PG_DUPLICATE_DATABASE) throw err
      }
    },

    async dropDatabase(dbName) {
      await pool.query(`DROP DATABASE IF EXISTS ${quoted(dbName)} WITH (FORCE)`)
    },
  }
}
