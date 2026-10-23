import { describe, expect, it } from 'vitest'

import { createTokenService } from './tokens.js'

const SECRET = 'x'.repeat(40)
const NOW = new Date('2026-01-01T00:00:00Z')

describe('tokens', () => {
  it('issues an access token that verifies back to the admin', async () => {
    const svc = createTokenService({ jwtSecret: SECRET, accessTtlSeconds: 3600 })

    const token = await svc.signAccess({ id: 'a1', email: 'a@x.io' }, NOW)
    const claims = await svc.verifyAccess(token, NOW)

    expect(claims).toEqual({ sub: 'a1', email: 'a@x.io', role: 'authenticated' })
  })

  it('rejects an expired access token', async () => {
    const svc = createTokenService({ jwtSecret: SECRET, accessTtlSeconds: 60 })
    const token = await svc.signAccess({ id: 'a1', email: 'a@x.io' }, NOW)

    const later = new Date(NOW.getTime() + 120_000)

    expect(await svc.verifyAccess(token, later)).toBeNull()
  })

  it('rejects a token signed with another secret', async () => {
    const a = createTokenService({ jwtSecret: SECRET, accessTtlSeconds: 60 })
    const b = createTokenService({ jwtSecret: 'y'.repeat(40), accessTtlSeconds: 60 })
    const token = await a.signAccess({ id: 'a1', email: 'a@x.io' }, NOW)

    expect(await b.verifyAccess(token, NOW)).toBeNull()
  })

  it('rejects garbage', async () => {
    const svc = createTokenService({ jwtSecret: SECRET, accessTtlSeconds: 60 })

    expect(await svc.verifyAccess('nope', NOW)).toBeNull()
  })

  it('creates unique opaque refresh tokens and a stable hash', () => {
    const svc = createTokenService({ jwtSecret: SECRET, accessTtlSeconds: 60 })

    const a = svc.newRefreshToken()
    const b = svc.newRefreshToken()

    expect(a).not.toBe(b)
    expect(svc.hashRefresh(a)).toBe(svc.hashRefresh(a))
    expect(svc.hashRefresh(a)).not.toContain(a)
  })
})
