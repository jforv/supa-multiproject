import { serve } from '@hono/node-server'
import pino from 'pino'

import { ensureBootstrapAdmin } from './auth/bootstrap.js'
import { buildContext } from './compose.js'
import { loadEnv } from './config/env.js'
import { migrate } from './db/migrate.js'
import { createApp } from './http/app.js'
import { startWorker } from './provisioner/worker.js'

const log = pino({ redact: ['*.password', '*.secret', 'req.headers.authorization'] })

async function main() {
  const env = loadEnv(process.env)
  const ctx = buildContext(env)

  const applied = await migrate(ctx.pool)
  if (applied.length > 0) log.info({ applied }, 'migrations applied')
  if (await ensureBootstrapAdmin(ctx.admins, env.bootstrapAdmin)) {
    log.info('bootstrap admin created')
  }

  const app = createApp({
    allowedOrigins: env.allowedOrigins,
    auth: ctx.auth,
    tokens: ctx.tokens,
    admins: ctx.admins,
    platform: {
      registry: ctx.registry,
      content: ctx.content,
      org: { slug: env.orgSlug, name: env.orgName },
      projectDb: { host: env.projectDbHost, port: env.projectDbPort },
      apiDomain: env.projectApiDomain,
      newProjectDb: ctx.newProjectDb,
      pgMeta: { url: env.pgMetaUrl, cryptoKey: env.pgMetaCryptoKey },
    },
  })

  const server = serve({ fetch: app.fetch, port: env.port }, (info) =>
    log.info({ port: info.port }, 'cp-api listening')
  )

  // A job claimed by a worker that dies is picked up again once its lease expires.
  const worker = startWorker(ctx.provisioner, {
    onError: (err) =>
      log.error({ err: err instanceof Error ? err.message : String(err) }, 'job failed'),
  })

  const shutdown = (signal: string) => {
    log.info({ signal }, 'shutting down')
    server.close(
      () =>
        void worker
          .stop()
          .then(() => Promise.all([ctx.pool.end(), ctx.adminPool.end()]))
          .then(() => process.exit(0))
    )
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

main().catch((err: unknown) => {
  // EnvError messages name variables but never values, so printing them is safe.
  log.fatal({ err: err instanceof Error ? err.message : String(err) }, 'cp-api failed to start')
  process.exit(1)
})
