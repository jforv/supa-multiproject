import { parseArgs } from 'node:util'

import { buildContext } from '../compose.js'
import { loadEnv } from '../config/env.js'
import { migrate } from '../db/migrate.js'
import { adoptProject } from '../registry/adopt.js'

const USAGE = `Usage: REGISTER_DB_PASSWORD=... register-project --ref <ref> --db <database> [--name <name>] [--db-user postgres]
Registers an existing database as a project. The DB password is read from REGISTER_DB_PASSWORD
so it never appears in the process list.`

async function main() {
  const { values } = parseArgs({
    options: {
      ref: { type: 'string' },
      db: { type: 'string' },
      name: { type: 'string' },
      'db-user': { type: 'string', default: 'postgres' },
    },
  })
  const dbPassword = process.env['REGISTER_DB_PASSWORD']
  if (!values.ref || !values.db || !dbPassword) {
    console.error(USAGE)
    process.exit(2)
  }

  const env = loadEnv(process.env)
  const ctx = buildContext(env)
  try {
    await migrate(ctx.pool)
    const project = await adoptProject(ctx.registry, {
      ref: values.ref,
      name: values.name ?? values.ref,
      orgSlug: env.orgSlug,
      dbName: values.db,
      dbUser: values['db-user'] ?? 'postgres',
      dbPassword,
    })
    console.log(
      `Registered project "${project.ref}" (id ${project.id}, database ${project.dbName})`
    )
  } finally {
    await ctx.pool.end()
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
