import { getConnInfo } from '@hono/node-server/conninfo'
import { Hono, type Context } from 'hono'
import { z } from 'zod'

import { AuthError, type Session } from '../auth/authService.js'
import type { AppDeps, AppEnv } from '../http/app.js'
import { ApiError } from '../http/errors.js'

const passwordGrant = z.object({ email: z.string().min(1), password: z.string().min(1) })
const refreshGrant = z.object({ refresh_token: z.string().min(1) })
const logoutBody = z.object({ refresh_token: z.string().min(1).optional() })

const authUser = (id: string, email: string) => ({
  id,
  email,
  aud: 'authenticated',
  role: 'authenticated',
  app_metadata: {},
  user_metadata: {},
})

const sessionBody = (s: Session, now: Date) => ({
  access_token: s.accessToken,
  token_type: 'bearer',
  expires_in: s.expiresIn,
  expires_at: Math.floor(now.getTime() / 1000) + s.expiresIn,
  refresh_token: s.refreshToken,
  user: authUser(s.admin.id, s.admin.email),
})

function toApiError(err: unknown): never {
  if (!(err instanceof AuthError)) throw err
  switch (err.code) {
    case 'rate_limited':
      throw new ApiError(429, 'Too many attempts, try again later', {
        error: 'over_request_rate_limit',
      })
    case 'invalid_token':
      throw new ApiError(400, 'Invalid Refresh Token', {
        error: 'invalid_grant',
        error_description: 'Invalid Refresh Token',
      })
    case 'invalid_credentials':
      throw new ApiError(400, 'Invalid login credentials', {
        error: 'invalid_grant',
        error_description: 'Invalid login credentials',
      })
  }
}

async function parseBody<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  const raw: unknown = await c.req.json().catch(() => ({}))
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    throw new ApiError(400, 'Invalid request body', { error: 'validation_failed' })
  }
  return parsed.data
}

// The socket peer, not X-Forwarded-For: a forged header would sidestep the login lockout.
function peerAddress(c: Context): string {
  try {
    return getConnInfo(c).remote.address ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

export function authRoutes(deps: AppDeps) {
  const routes = new Hono<AppEnv>()

  routes.post('/token', async (c) => {
    const grant = c.req.query('grant_type')
    const now = new Date()
    try {
      if (grant === 'password') {
        const { email, password } = await parseBody(c, passwordGrant)
        return c.json(sessionBody(await deps.auth.login(email, password, peerAddress(c), now), now))
      }
      if (grant === 'refresh_token') {
        const { refresh_token } = await parseBody(c, refreshGrant)
        return c.json(sessionBody(await deps.auth.refresh(refresh_token, now), now))
      }
    } catch (err) {
      return toApiError(err)
    }
    throw new ApiError(400, 'Unsupported grant_type', { error: 'unsupported_grant_type' })
  })

  routes.get('/user', async (c) => {
    const header = c.req.header('authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
    const claims = token ? await deps.tokens.verifyAccess(token) : null
    const admin = claims ? await deps.admins.findById(claims.sub) : null
    if (!admin || admin.disabled) throw new ApiError(401, 'Invalid or missing access token')
    return c.json(authUser(admin.id, admin.email))
  })

  routes.get('/settings', (c) =>
    c.json({ external: { email: true }, disable_signup: true, mailer_autoconfirm: true })
  )

  routes.post('/logout', async (c) => {
    const { refresh_token } = await parseBody(c, logoutBody)
    if (refresh_token) await deps.auth.logout(refresh_token)
    return c.body(null, 204)
  })

  return routes
}
