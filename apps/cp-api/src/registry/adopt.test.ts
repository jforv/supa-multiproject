import { jwtVerify } from 'jose'
import { describe, expect, it } from 'vitest'

import { createSecretBox } from '../crypto/secretBox.js'
import { adoptProject } from './adopt.js'
import { createMemoryProjectRepo } from './memoryRepo.js'
import { createProjectRegistry } from './registry.js'

function setup() {
  return createProjectRegistry({
    repo: createMemoryProjectRepo(),
    secretBox: createSecretBox({ activeKeyId: 'k1', keys: { k1: Buffer.alloc(32, 5) } }),
  })
}

const input = {
  ref: 'alpha',
  name: 'Alpha',
  orgSlug: 'default-org',
  dbName: 'proj_alpha',
  dbUser: 'postgres',
  dbPassword: 'existing-db-password',
}

describe('adoptProject', () => {
  it('registers an existing database as an active project', async () => {
    const registry = setup()

    const project = await adoptProject(registry, input)

    expect(project).toMatchObject({ ref: 'alpha', dbName: 'proj_alpha', status: 'ACTIVE_HEALTHY' })
  })

  it('keeps the supplied DB credentials and mints fresh API keys signed by a fresh JWT secret', async () => {
    const registry = setup()
    await adoptProject(registry, input)

    const secrets = await registry.getSecrets('alpha')

    expect(secrets).toMatchObject({ dbUser: 'postgres', dbPassword: 'existing-db-password' })
    const { payload } = await jwtVerify(
      secrets?.anonKey ?? '',
      new TextEncoder().encode(secrets?.jwtSecret)
    )
    expect(payload['role']).toBe('anon')
  })

  it('does not reuse JWT secrets across projects', async () => {
    const registry = setup()
    await adoptProject(registry, input)
    await adoptProject(registry, { ...input, ref: 'beta', dbName: 'proj_beta' })

    expect((await registry.getSecrets('alpha'))?.jwtSecret).not.toBe(
      (await registry.getSecrets('beta'))?.jwtSecret
    )
  })
})
