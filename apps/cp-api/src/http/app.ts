import { Hono } from 'hono'

import type { AuthService } from '../auth/authService.js'
import type { AdminRepo } from '../auth/ports.js'
import type { AccessClaims, TokenService } from '../auth/tokens.js'
import { authRoutes } from '../routes/auth.js'
import { platformRoutes, type PlatformDeps } from '../routes/platform.js'
import { ApiError, errorResponse } from './errors.js'

export interface AppDeps {
  readonly allowedOrigins: readonly string[]
  readonly auth: AuthService
  readonly tokens: TokenService
  readonly admins: AdminRepo
  readonly platform?: PlatformDeps
}

export type AppEnv = { Variables: { admin: AccessClaims } }

const ALLOWED_METHODS = 'GET,POST,PUT,PATCH,DELETE,OPTIONS'
const FALLBACK_ALLOWED_HEADERS = 'authorization,content-type,x-client-info,apikey'

export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>()
  const origins = new Set(deps.allowedOrigins)

  // Studio calls this API from the browser with credentials, so echo only listed origins.
  app.use('*', async (c, next) => {
    const origin = c.req.header('origin')
    const allowed = origin !== undefined && origins.has(origin)
    if (allowed) {
      c.header('Access-Control-Allow-Origin', origin)
      c.header('Access-Control-Allow-Credentials', 'true')
      c.header('Vary', 'Origin')
    }
    if (c.req.method !== 'OPTIONS') return next()
    if (allowed) {
      c.header('Access-Control-Allow-Methods', ALLOWED_METHODS)
      c.header(
        'Access-Control-Allow-Headers',
        c.req.header('access-control-request-headers') ?? FALLBACK_ALLOWED_HEADERS
      )
      c.header('Access-Control-Max-Age', '600')
    }
    return c.body(null, 204)
  })

  app.route('/auth', authRoutes(deps))
  if (deps.platform) app.route('/', platformRoutes({ ...deps, platform: deps.platform }))

  app.notFound((c) => c.json({ message: 'Not found' }, 404))
  app.onError((err, c) => {
    if (err instanceof ApiError) return errorResponse(c, err)
    console.error('unhandled error', err) // ponytail: swap for pino once server.ts wires a logger
    return c.json({ message: 'Internal server error' }, 500)
  })

  return app
}
