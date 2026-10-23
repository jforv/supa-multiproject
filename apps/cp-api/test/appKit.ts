import { createAuthService } from '../src/auth/authService.js'
import { createMemoryAdminRepo, createMemoryRefreshRepo } from '../src/auth/memoryRepos.js'
import { hashPassword } from '../src/auth/passwords.js'
import { createTokenService } from '../src/auth/tokens.js'
import { createMemoryContentRepo } from '../src/content/memoryRepo.js'
import { createSecretBox } from '../src/crypto/secretBox.js'
import { createApp } from '../src/http/app.js'
import { createMemoryJobRepo } from '../src/provisioner/memoryJobRepo.js'
import type { ProjectDbAdmin } from '../src/provisioner/ports.js'
import { createProvisioner } from '../src/provisioner/provisioner.js'
import { createMemoryProjectRepo } from '../src/registry/memoryRepo.js'
import { createProjectRegistry } from '../src/registry/registry.js'

export const TEST_META_KEY = 'meta-crypto-key'
export const TEST_ADMIN = { email: 'ada@x.io', password: 's3cret-pass-1' }

export interface MetaCall {
  readonly url: string
  readonly method: string
  readonly headers: Record<string, string>
  readonly body: string
}

/** A fully wired app over in-memory repos, logged in as a test admin. For route tests only. */
export async function buildTestApp(
  options: { metaReply?: () => Response; dbFailures?: number } = {}
) {
  const metaCalls: MetaCall[] = []
  const dbCalls: string[] = []
  let dbFailures = options.dbFailures ?? 0
  const dbAdmin: ProjectDbAdmin = {
    async createDatabase(name) {
      dbCalls.push(`create:${name}`)
      if (dbFailures-- > 0) throw new Error('boom')
    },
    async dropDatabase(name) {
      dbCalls.push(`drop:${name}`)
    },
  }

  const admins = createMemoryAdminRepo([
    {
      id: 'a1',
      email: TEST_ADMIN.email,
      passwordHash: await hashPassword(TEST_ADMIN.password),
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
  const jobs = createMemoryJobRepo()
  const registry = createProjectRegistry({
    repo: createMemoryProjectRepo(jobs),
    secretBox: createSecretBox({ activeKeyId: 'k1', keys: { k1: Buffer.alloc(32, 3) } }),
  })
  const provisioner = createProvisioner({ jobs, registry, dbAdmin })

  const app = createApp({
    allowedOrigins: [],
    auth,
    tokens,
    admins,
    platform: {
      registry,
      content: createMemoryContentRepo(),
      org: { slug: 'default-org', name: 'Default Org' },
      projectDb: { host: '127.0.0.1', port: 5441 },
      apiDomain: 'localhost:8000',
      newProjectDb: { user: 'postgres', password: 'shared-cluster-password' },
      pgMeta: {
        url: 'http://meta:8080',
        cryptoKey: TEST_META_KEY,
        fetch: async (url, init) => {
          metaCalls.push({
            url: String(url),
            method: init?.method ?? 'GET',
            headers: Object.fromEntries(new Headers(init?.headers).entries()),
            body: init?.body ? Buffer.from(init.body as ArrayBuffer).toString() : '',
          })
          return options.metaReply?.() ?? Response.json([{ ok: true }])
        },
      },
    },
  })

  const login = await app.request('/auth/token?grant_type=password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(TEST_ADMIN),
  })
  const accessToken = ((await login.json()) as { access_token: string }).access_token

  const call = (method: string, path: string, body?: unknown, authed = true) =>
    app.request(path, {
      method,
      headers: {
        ...(authed ? { authorization: `Bearer ${accessToken}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

  return { app, call, jobs, registry, provisioner, dbCalls, metaCalls }
}
