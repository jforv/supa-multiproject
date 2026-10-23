import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createSecretBox } from '../crypto/secretBox.js'
import { createProjectRegistry } from '../registry/registry.js'
import { createDb } from './client.js'
import { migrate } from './migrate.js'
import { createProjectRepo } from './projectRepo.js'

// Integration: set CP_TEST_DATABASE_URL to a throwaway Postgres (see repos.test.ts).
const url = process.env['CP_TEST_DATABASE_URL']

describe.skipIf(!url)('postgres project repo', () => {
  const { pool, db } = createDb(url ?? 'postgresql://unused')
  const registry = createProjectRegistry({
    repo: createProjectRepo(db),
    secretBox: createSecretBox({ activeKeyId: 'k1', keys: { k1: Buffer.alloc(32, 9) } }),
  })
  const secrets = {
    jwtSecret: 'jwt',
    dbPassword: 'pw-plain-marker',
    anonKey: 'a',
    serviceKey: 's',
    dbUser: 'postgres',
  }
  const input = { ref: 'alpha', name: 'Alpha', orgSlug: 'default-org', dbName: 'proj_alpha' }

  beforeAll(async () => {
    await migrate(pool)
  })
  beforeEach(async () => {
    await pool.query('TRUNCATE projects CASCADE')
  })
  afterAll(async () => {
    await pool.end()
  })

  it('registers, lists in id order and reads back', async () => {
    const a = await registry.register(input, secrets)
    const b = await registry.register({ ...input, ref: 'beta', dbName: 'proj_beta' }, secrets)

    expect(b.id).toBeGreaterThan(a.id)
    expect((await registry.list()).map((p) => p.ref)).toEqual(['alpha', 'beta'])
    expect((await registry.get('alpha'))?.dbName).toBe('proj_alpha')
  })

  it('keeps secrets encrypted in the table and decrypts on read', async () => {
    await registry.register(input, secrets)

    const { rows } = await pool.query<{ secrets_enc: string }>(
      'SELECT secrets_enc FROM project_secrets'
    )

    expect(rows[0]?.secrets_enc).not.toContain('pw-plain-marker')
    expect(await registry.getSecrets('alpha')).toEqual(secrets)
  })

  it('reports a duplicate ref and leaves no orphan secrets', async () => {
    await registry.register(input, secrets)

    await expect(registry.register(input, secrets)).rejects.toThrow(/already exists/)
    const { rows } = await pool.query('SELECT 1 FROM project_secrets')
    expect(rows).toHaveLength(1)
  })

  it('deleting a project cascades to its secrets', async () => {
    await registry.register(input, secrets)

    await pool.query("DELETE FROM projects WHERE ref='alpha'")

    expect((await pool.query('SELECT 1 FROM project_secrets')).rows).toHaveLength(0)
  })
})
