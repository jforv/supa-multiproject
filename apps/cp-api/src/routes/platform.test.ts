import CryptoJS from 'crypto-js'
import { describe, expect, it } from 'vitest'

import { createAuthService } from '../auth/authService.js'
import { createMemoryAdminRepo, createMemoryRefreshRepo } from '../auth/memoryRepos.js'
import { hashPassword } from '../auth/passwords.js'
import { createTokenService } from '../auth/tokens.js'
import { createSecretBox } from '../crypto/secretBox.js'
import { createApp } from '../http/app.js'
import { createMemoryProjectRepo } from '../registry/memoryRepo.js'
import { createProjectRegistry } from '../registry/registry.js'

const META_KEY = 'meta-crypto-key'
const SECRETS = {
  jwtSecret: 'jwt-secret-marker',
  dbPassword: 'db-password-marker',
  anonKey: 'anon.key.value',
  serviceKey: 'service.key.value',
  dbUser: 'postgres',
}
const ALPHA_CONN = 'postgresql://postgres:db-password-marker@127.0.0.1:5441/proj_alpha'

interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body: string
}

// JSON.parse yields untyped data, which keeps the assertions below readable.
const json = async (res: Response) => JSON.parse(await res.text())
const decrypt = (value: string) => CryptoJS.AES.decrypt(value, META_KEY).toString(CryptoJS.enc.Utf8)

async function setup(metaReply: () => Response = () => Response.json([{ ok: true }])) {
  const calls: Call[] = []
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
  const registry = createProjectRegistry({
    repo: createMemoryProjectRepo(),
    secretBox: createSecretBox({ activeKeyId: 'k1', keys: { k1: Buffer.alloc(32, 3) } }),
  })
  for (const [ref, name] of [
    ['alpha', 'Alpha'],
    ['beta', 'Beta'],
  ] as const) {
    await registry.register(
      { ref, name, orgSlug: 'default-org', dbName: `proj_${ref}`, status: 'ACTIVE_HEALTHY' },
      SECRETS
    )
  }
  const app = createApp({
    allowedOrigins: [],
    auth,
    tokens,
    admins,
    platform: {
      registry,
      org: { slug: 'default-org', name: 'Default Org' },
      projectDb: { host: '127.0.0.1', port: 5441 },
      apiDomain: 'localhost:8000',
      pgMeta: {
        url: 'http://meta:8080',
        cryptoKey: META_KEY,
        fetch: async (url, init) => {
          calls.push({
            url: String(url),
            method: init?.method ?? 'GET',
            headers: Object.fromEntries(new Headers(init?.headers).entries()),
            body: init?.body ? Buffer.from(init.body as ArrayBuffer).toString() : '',
          })
          return metaReply()
        },
      },
    },
  })
  const session = await json(
    await app.request('/auth/token?grant_type=password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ada@x.io', password: 's3cret-pass-1' }),
    })
  )
  const get = (path: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: { authorization: `Bearer ${session.access_token}`, ...init.headers },
    })
  return { app, get, calls }
}

describe('platform auth', () => {
  it('rejects unauthenticated requests with a message', async () => {
    const { app } = await setup()

    const res = await app.request('/platform/projects')

    expect(res.status).toBe(401)
    expect(await json(res)).toHaveProperty('message')
  })
})

describe('profile and organizations', () => {
  it('returns the profile with organizations and their projects', async () => {
    const { get } = await setup()

    const body = await json(await get('/platform/profile'))

    expect(body).toMatchObject({ gotrue_id: 'a1', primary_email: 'ada@x.io' })
    expect(body.organizations[0]).toMatchObject({ slug: 'default-org', name: 'Default Org' })
    expect(body.organizations[0].projects.map((p: { ref: string }) => p.ref)).toEqual([
      'alpha',
      'beta',
    ])
  })

  it('lists organizations and grants full permissions', async () => {
    const { get } = await setup()

    expect((await json(await get('/platform/organizations')))[0].slug).toBe('default-org')
    expect(await json(await get('/platform/profile/permissions'))).toEqual([
      {
        actions: ['%'],
        condition: true,
        organization_slug: 'default-org',
        resources: ['%'],
        project_refs: [],
      },
    ])
  })
})

describe('projects', () => {
  it('returns a bare array without limit, and a paginated envelope with it', async () => {
    const { get } = await setup()

    const bare = await json(await get('/platform/projects'))
    const page = await json(await get('/platform/projects?limit=1&offset=1'))

    expect(Array.isArray(bare)).toBe(true)
    expect(page.pagination).toEqual({ count: 2, limit: 1, offset: 1 })
    expect(page.projects.map((p: { ref: string }) => p.ref)).toEqual(['beta'])
  })

  it('serves the project detail Studio needs, without leaking secrets', async () => {
    const { get } = await setup()

    const text = await (await get('/platform/projects/alpha')).text()
    const body = JSON.parse(text)

    expect(body).toMatchObject({
      ref: 'alpha',
      name: 'Alpha',
      status: 'ACTIVE_HEALTHY',
      organization_slug: 'default-org',
      restUrl: 'http://alpha.localhost:8000/rest/v1/',
    })
    expect(typeof body.id).toBe('number')
    expect(text).not.toContain('db-password-marker')
    expect(text).not.toContain('jwt-secret-marker')
    expect(decrypt(body.connectionString)).toBe(ALPHA_CONN)
  })

  it('404s an unknown project with a message', async () => {
    const { get } = await setup()

    const res = await get('/platform/projects/nope')

    expect(res.status).toBe(404)
    expect(await json(res)).toHaveProperty('message')
  })

  it('lists databases for a project', async () => {
    const { get } = await setup()

    const body = await json(await get('/platform/projects/alpha/databases'))

    expect(body[0]).toMatchObject({ identifier: 'alpha', db_name: 'proj_alpha', db_port: 5441 })
  })

  it('serves settings with the per-project API endpoint and keys', async () => {
    const { get } = await setup()

    const body = await json(await get('/platform/projects/alpha/settings'))

    expect(body.app_config).toMatchObject({ endpoint: 'alpha.localhost:8000', protocol: 'http' })
    expect(body.service_api_keys.map((k: { tags: string }) => k.tags)).toEqual([
      'anon',
      'service_role',
    ])
    expect(body.ref).toBe('alpha')
  })

  it('lists organization projects with databases[] and pagination', async () => {
    const { get } = await setup()

    const body = await json(await get('/platform/organizations/default-org/projects?limit=10'))

    expect(body.pagination).toEqual({ count: 2, limit: 10, offset: 0 })
    expect(body.projects[0]).toMatchObject({
      ref: 'alpha',
      is_branch: false,
      databases: [{ identifier: 'alpha', type: 'PRIMARY', status: 'ACTIVE_HEALTHY' }],
    })
  })
})

describe('pg-meta passthrough', () => {
  it('forwards to postgres-meta with the project connection encrypted in a header', async () => {
    const { get, calls } = await setup()

    const res = await get('/platform/pg-meta/alpha/tables?included_schemas=public')

    expect(res.status).toBe(200)
    expect(await json(res)).toEqual([{ ok: true }])
    expect(calls[0]?.url).toBe('http://meta:8080/tables?included_schemas=public')
    expect(decrypt(calls[0]?.headers['x-connection-encrypted'] ?? '')).toBe(ALPHA_CONN)
  })

  it('routes each project to its own database', async () => {
    const { get, calls } = await setup()

    await get('/platform/pg-meta/beta/schemas')

    expect(decrypt(calls[0]?.headers['x-connection-encrypted'] ?? '')).toContain('/proj_beta')
  })

  it('relays POST bodies (the SQL editor path)', async () => {
    const { get, calls } = await setup()

    await get('/platform/pg-meta/alpha/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'select 1' }),
    })

    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.body).toBe('{"query":"select 1"}')
  })

  it('adds message to upstream errors that only carry error', async () => {
    const { get } = await setup(() => Response.json({ error: 'boom' }, { status: 500 }))

    const res = await get('/platform/pg-meta/alpha/query', { method: 'POST', body: '{}' })

    expect(res.status).toBe(500)
    expect(await json(res)).toMatchObject({ error: 'boom', message: 'boom' })
  })

  it('404s an unknown project and never calls postgres-meta', async () => {
    const { get, calls } = await setup()

    const res = await get('/platform/pg-meta/nope/tables')

    expect(res.status).toBe(404)
    expect(calls).toHaveLength(0)
  })

  it('502s with a message when postgres-meta is unreachable', async () => {
    const { get } = await setup(() => {
      throw new Error('ECONNREFUSED')
    })

    const res = await get('/platform/pg-meta/alpha/tables')

    expect(res.status).toBe(502)
    expect(await json(res)).toHaveProperty('message')
  })
})

describe('stubs', () => {
  it('answers the endpoints Studio polls with empty-but-valid bodies', async () => {
    const { get } = await setup()

    expect(await json(await get('/platform/notifications'))).toEqual([])
    expect(await json(await get('/platform/notifications/summary'))).toMatchObject({
      unread_count: 0,
    })
    expect(await json(await get('/v1/projects/alpha/api-keys'))).toEqual([])
    expect(await json(await get('/platform/projects/alpha/content'))).toEqual({ data: [] })
  })

  it('still 404s with a message for endpoints nobody implemented', async () => {
    const { get } = await setup()

    const res = await get('/platform/definitely-not-real')

    expect(res.status).toBe(404)
    expect(await json(res)).toHaveProperty('message')
  })
})
