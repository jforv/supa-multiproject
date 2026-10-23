import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createAuthService } from '../auth/authService.js'
import { hashPassword } from '../auth/passwords.js'
import { createTokenService } from '../auth/tokens.js'
import { createDb } from './client.js'
import { migrate } from './migrate.js'
import { createAdminRepo, createRefreshRepo } from './repos.js'

// Integration: needs a throwaway Postgres, e.g.
// CP_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5441/cp_test
const url = process.env['CP_TEST_DATABASE_URL']

describe.skipIf(!url)('postgres repos', () => {
  const { pool, db } = createDb(url ?? 'postgresql://unused')
  const admins = createAdminRepo(db)
  const refresh = createRefreshRepo(db)

  beforeAll(async () => {
    await migrate(pool)
  })
  beforeEach(async () => {
    await pool.query('TRUNCATE admins CASCADE')
  })
  afterAll(async () => {
    await pool.end()
  })

  it('migrate is idempotent', async () => {
    expect(await migrate(pool)).toEqual([])
  })

  it('stores admins lowercase and finds them by email or id', async () => {
    const id = randomUUID()
    await admins.insert({ id, email: 'Ada@X.io', passwordHash: 'h', disabled: false })

    expect((await admins.findByEmail('ADA@x.io'))?.id).toBe(id)
    expect((await admins.findById(id))?.email).toBe('ada@x.io')
    expect(await admins.count()).toBe(1)
    expect(await admins.findByEmail('nobody@x.io')).toBeNull()
  })

  it('markUsed succeeds exactly once', async () => {
    const adminId = randomUUID()
    await admins.insert({ id: adminId, email: 'a@x.io', passwordHash: 'h', disabled: false })
    await refresh.insert({
      tokenHash: 't1',
      adminId,
      familyId: randomUUID(),
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      revokedAt: null,
    })

    const results = await Promise.all([
      refresh.markUsed('t1', new Date()),
      refresh.markUsed('t1', new Date()),
    ])

    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it('runs the full login/refresh/replay flow against Postgres', async () => {
    await admins.insert({
      id: randomUUID(),
      email: 'ada@x.io',
      passwordHash: await hashPassword('s3cret-pass-1'),
      disabled: false,
    })
    const tokens = createTokenService({ jwtSecret: 'k'.repeat(40), accessTtlSeconds: 3600 })
    const svc = createAuthService({ admins, refresh, tokens, refreshTtlSeconds: 3600 })

    const first = await svc.login('ada@x.io', 's3cret-pass-1', 'ip')
    const second = await svc.refresh(first.refreshToken)

    await expect(svc.refresh(first.refreshToken)).rejects.toMatchObject({ code: 'invalid_token' })
    await expect(svc.refresh(second.refreshToken)).rejects.toMatchObject({ code: 'invalid_token' })
  })

  it('stores a password hash, never plaintext', async () => {
    const id = randomUUID()
    const passwordHash = await hashPassword('pw-pw-pw-pw-1')
    await admins.insert({ id, email: 'b@x.io', passwordHash, disabled: false })

    const { rows } = await pool.query<{ password_hash: string }>(
      'SELECT password_hash FROM admins WHERE id=$1',
      [id]
    )

    expect(rows[0]?.password_hash.startsWith('$argon2id$')).toBe(true)
  })
})
