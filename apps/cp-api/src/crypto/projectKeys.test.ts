import { jwtVerify } from 'jose'
import { describe, expect, it } from 'vitest'

import { generateProjectSecrets } from './projectKeys.js'

const TEN_YEARS_SECONDS = 10 * 365 * 24 * 60 * 60

describe('generateProjectSecrets', () => {
  it('creates a long jwt secret and a db password', async () => {
    const secrets = await generateProjectSecrets()

    expect(secrets.jwtSecret.length).toBeGreaterThanOrEqual(48)
    expect(secrets.dbPassword.length).toBeGreaterThanOrEqual(24)
  })

  it('signs anon and service_role keys verifiable with the jwt secret', async () => {
    const secrets = await generateProjectSecrets()
    const key = new TextEncoder().encode(secrets.jwtSecret)

    const anon = await jwtVerify(secrets.anonKey, key, { issuer: 'supabase' })
    const service = await jwtVerify(secrets.serviceKey, key, { issuer: 'supabase' })

    expect(anon.payload['role']).toBe('anon')
    expect(service.payload['role']).toBe('service_role')
    expect(anon.protectedHeader.alg).toBe('HS256')
  })

  it('gives the keys a roughly ten year lifetime', async () => {
    const now = new Date('2026-10-22T00:00:00Z')
    const secrets = await generateProjectSecrets(now)
    const key = new TextEncoder().encode(secrets.jwtSecret)

    const { payload } = await jwtVerify(secrets.anonKey, key, {
      currentDate: now,
    })
    const iat = payload.iat ?? 0
    const exp = payload.exp ?? 0

    expect(exp - iat).toBe(TEN_YEARS_SECONDS)
  })

  it('never reuses secrets between projects', async () => {
    const first = await generateProjectSecrets()
    const second = await generateProjectSecrets()

    expect(first.jwtSecret).not.toBe(second.jwtSecret)
    expect(first.dbPassword).not.toBe(second.dbPassword)
    expect(first.anonKey).not.toBe(second.anonKey)
  })

  it('does not accept an anon key signed with another project secret', async () => {
    const first = await generateProjectSecrets()
    const second = await generateProjectSecrets()
    const otherKey = new TextEncoder().encode(second.jwtSecret)

    await expect(jwtVerify(first.anonKey, otherKey)).rejects.toThrow()
  })
})
