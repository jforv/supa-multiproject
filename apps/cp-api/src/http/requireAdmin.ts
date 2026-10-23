import type { MiddlewareHandler } from 'hono'

import type { AdminRepo } from '../auth/ports.js'
import type { TokenService } from '../auth/tokens.js'
import type { AppEnv } from './app.js'
import { ApiError } from './errors.js'

const BEARER = 'Bearer '

/** Requires a valid access token for an admin that still exists and is enabled. */
export function requireAdmin(deps: {
  tokens: TokenService
  admins: AdminRepo
}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const header = c.req.header('authorization') ?? ''
    const token = header.startsWith(BEARER) ? header.slice(BEARER.length) : ''
    const claims = token ? await deps.tokens.verifyAccess(token) : null
    const admin = claims ? await deps.admins.findById(claims.sub) : null
    if (!claims || !admin || admin.disabled) {
      throw new ApiError(401, 'Invalid or missing access token')
    }
    c.set('admin', claims)
    await next()
  }
}
