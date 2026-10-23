import { describe, expect, it } from 'vitest'

import { AuthError, createAuthService } from './authService.js'
import { createMemoryAdminRepo, createMemoryRefreshRepo } from './memoryRepos.js'
import { hashPassword } from './passwords.js'
import { createTokenService } from './tokens.js'

const NOW = new Date('2026-01-01T00:00:00Z')
const at = (ms: number) => new Date(NOW.getTime() + ms)

async function setup() {
  const admins = createMemoryAdminRepo([
    {
      id: 'a1',
      email: 'ada@x.io',
      passwordHash: await hashPassword('s3cret-pass-1'),
      disabled: false,
    },
    {
      id: 'a2',
      email: 'off@x.io',
      passwordHash: await hashPassword('s3cret-pass-1'),
      disabled: true,
    },
  ])
  const refresh = createMemoryRefreshRepo()
  const tokens = createTokenService({ jwtSecret: 'k'.repeat(40), accessTtlSeconds: 3600 })
  const svc = createAuthService({ admins, refresh, tokens, refreshTtlSeconds: 86_400 })
  return { svc, tokens }
}

const code = async (p: Promise<unknown>) => {
  try {
    await p
    return 'ok'
  } catch (e) {
    return e instanceof AuthError ? e.code : 'other'
  }
}

describe('login', () => {
  it('returns access + refresh tokens for valid credentials', async () => {
    const { svc, tokens } = await setup()

    const res = await svc.login('Ada@X.io', 's3cret-pass-1', '1.1.1.1', NOW)

    expect(res.expiresIn).toBe(3600)
    expect(res.admin).toEqual({ id: 'a1', email: 'ada@x.io' })
    expect((await tokens.verifyAccess(res.accessToken, NOW))?.sub).toBe('a1')
    expect(res.refreshToken.length).toBeGreaterThan(20)
  })

  it('rejects a wrong password, an unknown email, and a disabled admin the same way', async () => {
    const { svc } = await setup()

    expect(await code(svc.login('ada@x.io', 'nope', 'ip', NOW))).toBe('invalid_credentials')
    expect(await code(svc.login('ghost@x.io', 'nope', 'ip', NOW))).toBe('invalid_credentials')
    expect(await code(svc.login('off@x.io', 's3cret-pass-1', 'ip', NOW))).toBe(
      'invalid_credentials'
    )
  })

  it('rate limits after repeated failures per email+ip, then recovers', async () => {
    const { svc } = await setup()
    for (let i = 0; i < 5; i++) await code(svc.login('ada@x.io', 'bad', '9.9.9.9', NOW))

    expect(await code(svc.login('ada@x.io', 's3cret-pass-1', '9.9.9.9', NOW))).toBe('rate_limited')
    expect(await code(svc.login('ada@x.io', 's3cret-pass-1', '2.2.2.2', NOW))).toBe('ok')
    expect(await code(svc.login('ada@x.io', 's3cret-pass-1', '9.9.9.9', at(16 * 60_000)))).toBe(
      'ok'
    )
  })
})

describe('refresh', () => {
  it('rotates: new tokens work, the old refresh token does not', async () => {
    const { svc } = await setup()
    const first = await svc.login('ada@x.io', 's3cret-pass-1', 'ip', NOW)

    const second = await svc.refresh(first.refreshToken, at(1000))

    expect(second.refreshToken).not.toBe(first.refreshToken)
    expect(await code(svc.refresh(first.refreshToken, at(2000)))).toBe('invalid_token')
  })

  it('reuse of a rotated token revokes the whole family', async () => {
    const { svc } = await setup()
    const first = await svc.login('ada@x.io', 's3cret-pass-1', 'ip', NOW)
    const second = await svc.refresh(first.refreshToken, at(1000))

    await code(svc.refresh(first.refreshToken, at(2000))) // replay

    expect(await code(svc.refresh(second.refreshToken, at(3000)))).toBe('invalid_token')
  })

  it('rejects expired and unknown tokens', async () => {
    const { svc } = await setup()
    const first = await svc.login('ada@x.io', 's3cret-pass-1', 'ip', NOW)

    expect(await code(svc.refresh(first.refreshToken, at(86_400_000 + 1)))).toBe('invalid_token')
    expect(await code(svc.refresh('garbage', NOW))).toBe('invalid_token')
  })
})

describe('logout', () => {
  it('revokes the session family', async () => {
    const { svc } = await setup()
    const first = await svc.login('ada@x.io', 's3cret-pass-1', 'ip', NOW)

    await svc.logout(first.refreshToken, at(10))

    expect(await code(svc.refresh(first.refreshToken, at(20)))).toBe('invalid_token')
  })

  it('is a no-op for unknown tokens', async () => {
    const { svc } = await setup()

    expect(await code(svc.logout('garbage', NOW))).toBe('ok')
  })
})
