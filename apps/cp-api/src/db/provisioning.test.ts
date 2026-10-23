import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createSecretBox } from '../crypto/secretBox.js'
import { createPgDbAdmin } from '../provisioner/pgDbAdmin.js'
import { createProvisioner } from '../provisioner/provisioner.js'
import { createProjectRegistry } from '../registry/registry.js'
import { createDb } from './client.js'
import { createJobRepo } from './jobRepo.js'
import { migrate } from './migrate.js'
import { createProjectRepo } from './projectRepo.js'

// Integration: set CP_TEST_DATABASE_URL to a throwaway Postgres whose role may CREATE DATABASE.
const url = process.env['CP_TEST_DATABASE_URL']
const SECRETS = {
  jwtSecret: 'j',
  dbPassword: 'p',
  anonKey: 'a',
  serviceKey: 's',
  dbUser: 'postgres',
}
// Jobs get run_after = the DB's real now(), so the test clock must start at (just after) real time.
const T0 = new Date(Date.now() + 10_000)
const at = (ms: number) => new Date(T0.getTime() + ms)

describe.skipIf(!url)('postgres provisioning', () => {
  const { pool, db } = createDb(url ?? 'postgresql://unused')
  const jobs = createJobRepo(db)
  const registry = createProjectRegistry({
    repo: createProjectRepo(db),
    secretBox: createSecretBox({ activeKeyId: 'k1', keys: { k1: Buffer.alloc(32, 4) } }),
  })
  const dbAdmin = createPgDbAdmin(pool)
  const provisioner = createProvisioner({
    jobs,
    registry,
    dbAdmin,
    leaseMs: 60_000,
    maxAttempts: 3,
  })
  const exists = async (name: string) =>
    ((await pool.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])).rowCount ?? 0) > 0
  const create = (ref: string) =>
    registry.register(
      { ref, name: ref, orgSlug: 'default-org', dbName: `proj_t_${ref}`, provision: true },
      SECRETS,
      T0
    )

  beforeAll(async () => {
    await migrate(pool)
  })
  beforeEach(async () => {
    await pool.query('TRUNCATE projects, jobs CASCADE')
    await dbAdmin.dropDatabase('proj_t_alpha')
    await dbAdmin.dropDatabase('proj_t_beta')
  })
  afterAll(async () => {
    await dbAdmin.dropDatabase('proj_t_alpha')
    await dbAdmin.dropDatabase('proj_t_beta')
    await pool.end()
  })

  it('creates a real database, marks the project healthy, and deletes it with no residue', async () => {
    await create('alpha')

    await provisioner.runOnce(at(0))
    expect(await exists('proj_t_alpha')).toBe(true)
    expect((await registry.get('alpha'))?.status).toBe('ACTIVE_HEALTHY')

    await registry.requestDelete('alpha', at(1))
    await provisioner.runOnce(at(2))

    expect(await exists('proj_t_alpha')).toBe(false)
    expect(await registry.get('alpha')).toBeNull()
    expect((await pool.query('SELECT 1 FROM project_secrets')).rowCount).toBe(0)
  })

  it('queues the create job in the same transaction as the project', async () => {
    await create('alpha')

    const { rows } = await pool.query('SELECT kind, status FROM jobs')

    expect(rows).toEqual([{ kind: 'create', status: 'pending' }])
  })

  it('a duplicate ref leaves no extra job behind', async () => {
    await create('alpha')

    await expect(create('alpha')).rejects.toThrow(/already exists/)

    expect((await pool.query('SELECT 1 FROM jobs')).rowCount).toBe(1)
  })

  it('claim hands one job to exactly one of two concurrent workers', async () => {
    await create('alpha')

    const claims = await Promise.all([jobs.claim(at(0), 60_000), jobs.claim(at(0), 60_000)])

    expect(claims.filter(Boolean)).toHaveLength(1)
    expect(claims.find(Boolean)).toMatchObject({ kind: 'create', attempts: 1 })
  })

  it('reclaims a job whose lease expired (killed worker) and counts the attempt', async () => {
    await create('alpha')
    await jobs.claim(at(0), 60_000)

    expect(await jobs.claim(at(30_000), 60_000)).toBeNull()
    const again = await jobs.claim(at(60_001), 60_000)

    expect(again).toMatchObject({ kind: 'create', attempts: 2 })
  })

  it('creating over an already-existing database is a no-op, not an error', async () => {
    await dbAdmin.createDatabase('proj_t_beta')

    await expect(dbAdmin.createDatabase('proj_t_beta')).resolves.toBeUndefined()
    await expect(dbAdmin.dropDatabase('proj_t_missing')).resolves.toBeUndefined()
  })

  it('refuses database names that are not plain identifiers', async () => {
    await expect(dbAdmin.createDatabase('x"; drop database cp; --')).rejects.toThrow(/unsafe/)
    await expect(dbAdmin.dropDatabase('Bad-Name')).rejects.toThrow(/unsafe/)
  })

  it('requestDelete queues one live delete job and 404s unknown refs', async () => {
    await create('alpha')

    expect(await registry.requestDelete('alpha', at(1))).toBe(true)
    expect(await registry.requestDelete('alpha', at(2))).toBe(true)
    expect(await registry.requestDelete('nope', at(3))).toBe(false)

    const { rows } = await pool.query("SELECT 1 FROM jobs WHERE kind='delete'")
    expect(rows).toHaveLength(1)
  })
})
