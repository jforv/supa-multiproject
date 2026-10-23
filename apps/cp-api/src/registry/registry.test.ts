import { describe, expect, it } from 'vitest'

import { createSecretBox } from '../crypto/secretBox.js'
import { createMemoryProjectRepo } from './memoryRepo.js'
import { createProjectRegistry, type StoredSecrets } from './registry.js'

const NOW = new Date('2026-01-01T00:00:00Z')
const SECRETS: StoredSecrets = {
  jwtSecret: 'jwt-secret-value',
  dbPassword: 'hunter2-db-password',
  anonKey: 'anon.key.value',
  serviceKey: 'service.key.value',
  dbUser: 'postgres',
}

function setup() {
  const repo = createMemoryProjectRepo()
  const secretBox = createSecretBox({
    activeKeyId: 'k1',
    keys: { k1: Buffer.alloc(32, 7) },
  })
  return { repo, registry: createProjectRegistry({ repo, secretBox }) }
}

const input = { ref: 'alpha', name: 'Alpha', orgSlug: 'default-org', dbName: 'proj_alpha' }

describe('project registry', () => {
  it('registers a project and assigns a numeric id', async () => {
    const { registry } = setup()

    const first = await registry.register(input, SECRETS, NOW)
    const second = await registry.register(
      { ...input, ref: 'beta', dbName: 'proj_beta' },
      SECRETS,
      NOW
    )

    expect(first).toMatchObject({ ref: 'alpha', status: 'COMING_UP', version: 1, createdAt: NOW })
    expect(second.id).toBe(first.id + 1)
  })

  it('stores secrets encrypted and round-trips them', async () => {
    const { registry, repo } = setup()
    await registry.register(input, SECRETS, NOW)

    const stored = await repo.getSecretsEnc('alpha')

    expect(stored).not.toContain('hunter2-db-password')
    expect(stored).not.toContain('jwt-secret-value')
    expect(await registry.getSecrets('alpha')).toEqual(SECRETS)
  })

  it('lists in creation order and finds by ref', async () => {
    const { registry } = setup()
    await registry.register(input, SECRETS, NOW)
    await registry.register({ ...input, ref: 'beta', dbName: 'proj_beta' }, SECRETS, NOW)

    expect((await registry.list()).map((p) => p.ref)).toEqual(['alpha', 'beta'])
    expect((await registry.get('beta'))?.name).toBe('Alpha')
    expect(await registry.get('nope')).toBeNull()
    expect(await registry.getSecrets('nope')).toBeNull()
  })

  it('rejects a duplicate ref', async () => {
    const { registry } = setup()
    await registry.register(input, SECRETS, NOW)

    await expect(registry.register(input, SECRETS, NOW)).rejects.toThrow(/already exists/)
  })

  it('rejects an invalid ref', async () => {
    const { registry } = setup()

    await expect(registry.register({ ...input, ref: 'Bad Ref!' }, SECRETS, NOW)).rejects.toThrow(
      /ref/
    )
  })
})
