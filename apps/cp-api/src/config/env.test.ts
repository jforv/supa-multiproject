import { describe, expect, it } from 'vitest'

import { EnvError, loadEnv } from './env.js'

const MASTER_KEY = Buffer.alloc(32, 7).toString('base64')

const validSource = {
  CP_DATABASE_URL: 'postgresql://cp:secret-db-pass@localhost:5441/cp',
  CP_MASTER_KEY: MASTER_KEY,
  CP_JWT_SECRET: 'j'.repeat(48),
  CP_ALLOWED_ORIGINS: 'http://localhost:8082, http://studio.example.test:8082',
  CP_PG_META_URL: 'http://127.0.0.1:8110',
  CP_PG_META_CRYPTO_KEY: 'meta-crypto-key',
}

describe('loadEnv', () => {
  it('parses a valid environment and applies defaults', () => {
    const env = loadEnv(validSource)

    expect(env.port).toBe(8100)
    expect(env.orgSlug).toBe('default-org')
    expect(env.orgName).toBe('Default Org')
    expect(env.allowedOrigins).toEqual(['http://localhost:8082', 'http://studio.example.test:8082'])
    expect(env.masterKey.length).toBe(32)
    expect(env.bootstrapAdmin).toBeUndefined()
    expect(env.projectDbHost).toBe('127.0.0.1')
    expect(env.projectDbPort).toBe(5432)
    expect(env.projectApiDomain).toBe('localhost:8000')
  })

  it('reads the project database target and API domain', () => {
    const env = loadEnv({
      ...validSource,
      CP_PROJECT_DB_HOST: 'db',
      CP_PROJECT_DB_PORT: '6543',
      CP_PROJECT_API_DOMAIN: 'supa.lan',
    })

    expect(env).toMatchObject({
      projectDbHost: 'db',
      projectDbPort: 6543,
      projectApiDomain: 'supa.lan',
    })
  })

  it('lists every missing variable by name', () => {
    const attempt = () => loadEnv({})

    expect(attempt).toThrow(EnvError)
    try {
      attempt()
    } catch (error) {
      const message = (error as Error).message
      expect(message).toContain('CP_DATABASE_URL')
      expect(message).toContain('CP_MASTER_KEY')
      expect(message).toContain('CP_JWT_SECRET')
    }
  })

  it('rejects a master key that is not 32 bytes', () => {
    const short = Buffer.alloc(16, 1).toString('base64')

    expect(() => loadEnv({ ...validSource, CP_MASTER_KEY: short })).toThrow(/CP_MASTER_KEY/)
  })

  it('rejects a short JWT secret', () => {
    expect(() => loadEnv({ ...validSource, CP_JWT_SECRET: 'too-short' })).toThrow(/CP_JWT_SECRET/)
  })

  it('never echoes secret values in the error message', () => {
    try {
      loadEnv({ ...validSource, CP_JWT_SECRET: 'short-but-secret' })
      expect.unreachable('should have thrown')
    } catch (error) {
      const message = (error as Error).message
      expect(message).not.toContain('short-but-secret')
      expect(message).not.toContain('secret-db-pass')
    }
  })

  it('requires the bootstrap admin email and password together', () => {
    expect(() => loadEnv({ ...validSource, CP_BOOTSTRAP_ADMIN_EMAIL: 'a@example.com' })).toThrow(
      /CP_BOOTSTRAP_ADMIN/
    )
  })

  it('accepts a complete bootstrap admin', () => {
    const env = loadEnv({
      ...validSource,
      CP_BOOTSTRAP_ADMIN_EMAIL: 'admin@example.com',
      CP_BOOTSTRAP_ADMIN_PASSWORD: 'correct horse battery staple',
    })

    expect(env.bootstrapAdmin).toEqual({
      email: 'admin@example.com',
      password: 'correct horse battery staple',
    })
  })

  it('rejects an empty allowed-origins list', () => {
    expect(() => loadEnv({ ...validSource, CP_ALLOWED_ORIGINS: ' , ' })).toThrow(
      /CP_ALLOWED_ORIGINS/
    )
  })
})
