import { createAuthService } from './auth/authService.js'
import { createTokenService } from './auth/tokens.js'
import type { Env } from './config/env.js'
import { createSecretBox } from './crypto/secretBox.js'
import { createDb } from './db/client.js'
import { createProjectRepo } from './db/projectRepo.js'
import { createAdminRepo, createRefreshRepo } from './db/repos.js'
import { createProjectRegistry } from './registry/registry.js'

const ACCESS_TTL_SECONDS = 3600
const REFRESH_TTL_SECONDS = 30 * 24 * 3600

/** Composition root: the only place concrete repos meet the services. */
export function buildContext(env: Env) {
  const { pool, db } = createDb(env.databaseUrl)
  const admins = createAdminRepo(db)
  const tokens = createTokenService({
    jwtSecret: env.jwtSecret,
    accessTtlSeconds: ACCESS_TTL_SECONDS,
  })
  const auth = createAuthService({
    admins,
    refresh: createRefreshRepo(db),
    tokens,
    accessTtlSeconds: ACCESS_TTL_SECONDS,
    refreshTtlSeconds: REFRESH_TTL_SECONDS,
  })
  const secretBox = createSecretBox({
    activeKeyId: env.masterKeyId,
    keys: { [env.masterKeyId]: env.masterKey },
  })
  const registry = createProjectRegistry({ repo: createProjectRepo(db), secretBox })
  return { pool, admins, tokens, auth, registry }
}

export type Context = ReturnType<typeof buildContext>
