import { describe, expect, it } from 'vitest'

import { createSecretBox } from '../crypto/secretBox.js'
import { createMemoryProjectRepo } from '../registry/memoryRepo.js'
import { createProjectRegistry } from '../registry/registry.js'
import { createMemoryJobRepo } from './memoryJobRepo.js'
import type { ProjectDbAdmin } from './ports.js'
import { createProvisioner } from './provisioner.js'

const T0 = new Date('2026-01-01T00:00:00Z')
const at = (ms: number) => new Date(T0.getTime() + ms)
const SECRETS = {
  jwtSecret: 'j',
  dbPassword: 'p',
  anonKey: 'a',
  serviceKey: 's',
  dbUser: 'postgres',
}

function fakeDbAdmin(failures: { create?: number; drop?: number } = {}) {
  const calls: string[] = []
  const left = { create: failures.create ?? 0, drop: failures.drop ?? 0 }
  const admin: ProjectDbAdmin = {
    async createDatabase(name) {
      calls.push(`create:${name}`)
      if (left.create-- > 0) throw new Error('connection refused')
    },
    async dropDatabase(name) {
      calls.push(`drop:${name}`)
      if (left.drop-- > 0) throw new Error('database is being accessed')
    },
  }
  return { admin, calls }
}

function setup(failures?: { create?: number; drop?: number }, maxAttempts = 3) {
  const jobs = createMemoryJobRepo()
  const repo = createMemoryProjectRepo(jobs)
  const registry = createProjectRegistry({
    repo,
    secretBox: createSecretBox({ activeKeyId: 'k1', keys: { k1: Buffer.alloc(32, 1) } }),
  })
  const db = fakeDbAdmin(failures)
  const provisioner = createProvisioner({
    jobs,
    registry,
    dbAdmin: db.admin,
    leaseMs: 60_000,
    maxAttempts,
    backoffMs: (attempt) => 1000 * attempt,
  })
  const create = (ref = 'alpha') =>
    registry.register(
      { ref, name: 'Alpha', orgSlug: 'default-org', dbName: `proj_${ref}`, provision: true },
      SECRETS,
      T0
    )
  return { jobs, registry, provisioner, db, create }
}

describe('create job', () => {
  it('creates the database and marks the project healthy', async () => {
    const { provisioner, registry, db, create } = setup()
    await create()

    const worked = await provisioner.runOnce(at(0))

    expect(worked).toBe(true)
    expect(db.calls).toEqual(['create:proj_alpha'])
    expect((await registry.get('alpha'))?.status).toBe('ACTIVE_HEALTHY')
  })

  it('does nothing when the queue is empty', async () => {
    const { provisioner } = setup()

    expect(await provisioner.runOnce(at(0))).toBe(false)
  })

  it('retries with backoff after a transient failure, then succeeds', async () => {
    const { provisioner, registry, db, create } = setup({ create: 1 })
    await create()

    await provisioner.runOnce(at(0)) // fails, retry at +1000
    expect(await provisioner.runOnce(at(500))).toBe(false) // not due yet
    await provisioner.runOnce(at(1000))

    expect(db.calls).toEqual(['create:proj_alpha', 'create:proj_alpha'])
    expect((await registry.get('alpha'))?.status).toBe('ACTIVE_HEALTHY')
  })

  it('marks the project INIT_FAILED once attempts are exhausted', async () => {
    const { provisioner, registry, jobs, create } = setup({ create: 99 }, 2)
    await create()

    await provisioner.runOnce(at(0))
    await provisioner.runOnce(at(10_000))

    expect((await registry.get('alpha'))?.status).toBe('INIT_FAILED')
    expect(jobs.all()[0]).toMatchObject({ status: 'failed', lastError: 'connection refused' })
    expect(await provisioner.runOnce(at(20_000))).toBe(false)
  })

  it('resumes a job whose worker died: the lease expires and the step reruns', async () => {
    const { provisioner, jobs, registry, db, create } = setup()
    await create()
    await jobs.claim(at(0), 60_000) // a worker claimed it, then was killed -9

    expect(await provisioner.runOnce(at(30_000))).toBe(false) // lease still held
    await provisioner.runOnce(at(60_001))

    expect(db.calls).toEqual(['create:proj_alpha'])
    expect((await registry.get('alpha'))?.status).toBe('ACTIVE_HEALTHY')
  })

  it('does not build a project whose delete was requested before the create ran', async () => {
    const { provisioner, registry, db, create } = setup()
    await create()
    await registry.requestDelete('alpha', at(0))

    await provisioner.runOnce(at(1)) // the create job: skipped
    await provisioner.runOnce(at(2)) // the delete job

    expect(db.calls).toEqual(['drop:proj_alpha'])
    expect(await registry.get('alpha')).toBeNull()
  })

  it('completes quietly when the project was removed meanwhile', async () => {
    const { provisioner, registry, db, create } = setup()
    await create()
    await registry.remove('alpha')

    await provisioner.runOnce(at(0))

    expect(db.calls).toEqual([])
  })
})

describe('delete job', () => {
  it('drops the database and removes the project', async () => {
    const { provisioner, registry, db, create } = setup()
    await create()
    await provisioner.runOnce(at(0))

    expect(await registry.requestDelete('alpha', at(1))).toBe(true)
    expect((await registry.get('alpha'))?.status).toBe('GOING_DOWN')
    await provisioner.runOnce(at(2))

    expect(db.calls).toEqual(['create:proj_alpha', 'drop:proj_alpha'])
    expect(await registry.get('alpha')).toBeNull()
    expect(await registry.getSecrets('alpha')).toBeNull()
  })

  it('can delete a project that failed to initialise', async () => {
    const { provisioner, registry, db, create } = setup({ create: 99 }, 1)
    await create()
    await provisioner.runOnce(at(0))
    expect((await registry.get('alpha'))?.status).toBe('INIT_FAILED')

    await registry.requestDelete('alpha', at(1))
    await provisioner.runOnce(at(2))

    expect(db.calls).toContain('drop:proj_alpha')
    expect(await registry.get('alpha')).toBeNull()
  })

  it('keeps the project GOING_DOWN and retries when the drop fails', async () => {
    const { provisioner, registry, create } = setup({ drop: 1 })
    await create()
    await provisioner.runOnce(at(0))
    await registry.requestDelete('alpha', at(1))

    await provisioner.runOnce(at(2))
    expect((await registry.get('alpha'))?.status).toBe('GOING_DOWN')
    await provisioner.runOnce(at(2000))

    expect(await registry.get('alpha')).toBeNull()
  })

  it('queues one delete job however many times it is requested', async () => {
    const { jobs, registry, create } = setup()
    await create()

    await registry.requestDelete('alpha', at(1))
    await registry.requestDelete('alpha', at(2))

    expect(jobs.all().filter((j) => j.kind === 'delete')).toHaveLength(1)
  })

  it('reports false for an unknown project', async () => {
    const { registry } = setup()

    expect(await registry.requestDelete('nope', at(1))).toBe(false)
  })
})

describe('concurrency', () => {
  it('two workers never run the same job', async () => {
    const { provisioner, db, create } = setup()
    await create()

    await Promise.all([provisioner.runOnce(at(0)), provisioner.runOnce(at(0))])

    expect(db.calls).toEqual(['create:proj_alpha'])
  })
})
