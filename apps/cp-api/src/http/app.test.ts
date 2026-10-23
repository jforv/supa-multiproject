import { describe, expect, it } from 'vitest'

import { createAuthService } from '../auth/authService.js'
import { createMemoryAdminRepo, createMemoryRefreshRepo } from '../auth/memoryRepos.js'
import { hashPassword } from '../auth/passwords.js'
import { createTokenService } from '../auth/tokens.js'
import { createApp } from './app.js'

const ORIGIN = 'http://studio.example.test:8082'
type App = Awaited<ReturnType<typeof setup>>

async function setup() {
  const admins = createMemoryAdminRepo([
    {
      id: 'a1',
      email: 'ada@x.io',
      passwordHash: await hashPassword('s3cret-pass-1'),
      disabled: false,
    },
  ])
  const tokens = createTokenService({ jwtSecret: 'k'.repeat(40), accessTtlSeconds: 3600 })
  const auth = createAuthService({
    admins,
    refresh: createMemoryRefreshRepo(),
    tokens,
    refreshTtlSeconds: 3600,
  })
  return createApp({ allowedOrigins: [ORIGIN], auth, tokens, admins })
}

const post = (app: App, path: string, body: unknown, headers = {}) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })

const json = async (res: Response) => (await res.json()) as Record<string, unknown>

const login = async (app: App) =>
  json(
    await post(app, '/auth/token?grant_type=password', {
      email: 'ada@x.io',
      password: 's3cret-pass-1',
    })
  )

describe('POST /auth/token', () => {
  it('password grant returns a GoTrue-shaped session', async () => {
    const app = await setup()

    const res = await post(app, '/auth/token?grant_type=password', {
      email: 'ada@x.io',
      password: 's3cret-pass-1',
    })
    const body = await json(res)

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      token_type: 'bearer',
      expires_in: 3600,
      user: { id: 'a1', email: 'ada@x.io', aud: 'authenticated', role: 'authenticated' },
    })
    expect(typeof body['access_token']).toBe('string')
    expect(typeof body['refresh_token']).toBe('string')
    expect(typeof body['expires_at']).toBe('number')
  })

  it('bad password is 400 with a message', async () => {
    const app = await setup()

    const res = await post(app, '/auth/token?grant_type=password', {
      email: 'ada@x.io',
      password: 'nope',
    })

    expect(res.status).toBe(400)
    expect(await json(res)).toMatchObject({
      error: 'invalid_grant',
      message: 'Invalid login credentials',
    })
  })

  it('locks out with 429 after repeated failures', async () => {
    const app = await setup()
    for (let i = 0; i < 5; i++) {
      await post(app, '/auth/token?grant_type=password', { email: 'ada@x.io', password: 'bad' })
    }

    const res = await post(app, '/auth/token?grant_type=password', {
      email: 'ada@x.io',
      password: 's3cret-pass-1',
    })

    expect(res.status).toBe(429)
    expect(await json(res)).toHaveProperty('message')
  })

  it('refresh_token grant rotates the session', async () => {
    const app = await setup()
    const first = await login(app)

    const res = await post(app, '/auth/token?grant_type=refresh_token', {
      refresh_token: first['refresh_token'],
    })
    const second = await json(res)

    expect(res.status).toBe(200)
    expect(second['refresh_token']).not.toBe(first['refresh_token'])
    const replay = await post(app, '/auth/token?grant_type=refresh_token', {
      refresh_token: first['refresh_token'],
    })
    expect(replay.status).toBe(400)
  })

  it('rejects unsupported grants and malformed bodies with a message', async () => {
    const app = await setup()

    const grant = await post(app, '/auth/token?grant_type=magic', {})
    const malformed = await post(app, '/auth/token?grant_type=password', { email: 5 })

    expect(grant.status).toBe(400)
    expect(await json(grant)).toHaveProperty('message')
    expect(malformed.status).toBe(400)
    expect(await json(malformed)).toHaveProperty('message')
  })
})

describe('GET /auth/user', () => {
  it('returns the admin for a valid bearer token', async () => {
    const app = await setup()
    const session = await login(app)

    const res = await app.request('/auth/user', {
      headers: { authorization: `Bearer ${session['access_token']}` },
    })

    expect(res.status).toBe(200)
    expect(await json(res)).toMatchObject({ id: 'a1', email: 'ada@x.io', role: 'authenticated' })
  })

  it('401 with message without or with a bad token', async () => {
    const app = await setup()

    const none = await app.request('/auth/user')
    const bad = await app.request('/auth/user', { headers: { authorization: 'Bearer junk' } })

    expect(none.status).toBe(401)
    expect(bad.status).toBe(401)
    expect(await json(none)).toHaveProperty('message')
  })
})

describe('GET /auth/settings', () => {
  it('is public and disables signup', async () => {
    const app = await setup()

    const res = await app.request('/auth/settings')

    expect(res.status).toBe(200)
    expect(await json(res)).toMatchObject({ disable_signup: true })
  })
})

describe('POST /auth/logout', () => {
  it('revokes the refresh token and returns 204', async () => {
    const app = await setup()
    const session = await login(app)

    const res = await post(
      app,
      '/auth/logout',
      { refresh_token: session['refresh_token'] },
      { authorization: `Bearer ${session['access_token']}` }
    )
    const replay = await post(app, '/auth/token?grant_type=refresh_token', {
      refresh_token: session['refresh_token'],
    })

    expect(res.status).toBe(204)
    expect(replay.status).toBe(400)
  })
})

describe('CORS and errors', () => {
  it('echoes an allowed origin with credentials', async () => {
    const app = await setup()

    const res = await app.request('/auth/settings', { headers: { origin: ORIGIN } })

    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(res.headers.get('access-control-allow-credentials')).toBe('true')
  })

  it('does not echo an unknown origin', async () => {
    const app = await setup()

    const res = await app.request('/auth/settings', { headers: { origin: 'http://evil.test' } })

    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('answers preflight with 204 and allow headers', async () => {
    const app = await setup()

    const res = await app.request('/auth/token', {
      method: 'OPTIONS',
      headers: { origin: ORIGIN, 'access-control-request-method': 'POST' },
    })

    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-methods')).toContain('POST')
    expect(res.headers.get('access-control-allow-headers')).not.toBeNull()
  })

  it('unknown routes are 404 with a message', async () => {
    const app = await setup()

    const res = await app.request('/nope')

    expect(res.status).toBe(404)
    expect(await json(res)).toHaveProperty('message')
  })
})
