import { describe, expect, it } from 'vitest'

import { buildTestApp } from '../../test/appKit.js'

// JSON.parse yields untyped data, which keeps the assertions below readable.
const json = async (res: Response) => JSON.parse(await res.text())

const NEW_PROJECT = {
  name: 'My App',
  organization_slug: 'default-org',
  db_pass: 'ignored-in-shared-role-mode',
  cloud_provider: 'AWS',
}

describe('POST /platform/projects', () => {
  it('creates a project in COMING_UP and queues its provisioning', async () => {
    const { call, jobs } = await buildTestApp()

    const res = await call('POST', '/platform/projects', NEW_PROJECT)
    const body = await json(res)

    expect(res.status).toBe(201)
    expect(body).toMatchObject({
      name: 'My App',
      organization_slug: 'default-org',
      status: 'COMING_UP',
      is_branch_enabled: false,
    })
    expect(body.ref).toMatch(/^[a-z]{20}$/)
    expect(body.endpoint).toBe(`${body.ref}.localhost:8000`)
    expect(typeof body.id).toBe('number')
    expect(jobs.all()).toMatchObject([{ projectRef: body.ref, kind: 'create' }])
  })

  it('returns the API keys but never the database password or JWT secret', async () => {
    const { call, registry } = await buildTestApp()

    const text = await (await call('POST', '/platform/projects', NEW_PROJECT)).text()
    const body = JSON.parse(text)
    const stored = await registry.getSecrets(body.ref)

    expect(body.anon_key).toBe(stored?.anonKey)
    expect(body.service_key).toBe(stored?.serviceKey)
    expect(text).not.toContain('shared-cluster-password')
    expect(text).not.toContain(stored?.jwtSecret ?? 'x')
  })

  it('stores the shared cluster credentials and a fresh JWT secret per project', async () => {
    const { call, registry } = await buildTestApp()

    const a = await json(await call('POST', '/platform/projects', NEW_PROJECT))
    const b = await json(await call('POST', '/platform/projects', NEW_PROJECT))

    const sa = await registry.getSecrets(a.ref)
    const sb = await registry.getSecrets(b.ref)
    expect(sa).toMatchObject({ dbUser: 'postgres', dbPassword: 'shared-cluster-password' })
    expect(sa?.jwtSecret).not.toBe(sb?.jwtSecret)
    expect(a.ref).not.toBe(b.ref)
  })

  it('rejects an unknown organization and an empty name with a message', async () => {
    const { call, jobs } = await buildTestApp()

    const org = await call('POST', '/platform/projects', {
      ...NEW_PROJECT,
      organization_slug: 'someone-else',
    })
    const name = await call('POST', '/platform/projects', { ...NEW_PROJECT, name: '   ' })
    const missing = await call('POST', '/platform/projects', {})

    for (const res of [org, name, missing]) {
      expect(res.status).toBe(400)
      expect(await json(res)).toHaveProperty('message')
    }
    expect(jobs.all()).toHaveLength(0)
  })

  it('requires authentication', async () => {
    const { call } = await buildTestApp()

    const res = await call('POST', '/platform/projects', NEW_PROJECT, false)

    expect(res.status).toBe(401)
  })
})

describe('GET /platform/projects/available-regions', () => {
  it('offers a single local region in the RegionsInfo shape, not a project lookup', async () => {
    const { call } = await buildTestApp()

    const res = await call(
      'GET',
      '/platform/projects/available-regions?cloud_provider=AWS&organization_slug=default-org'
    )
    const body = await json(res)

    expect(res.status).toBe(200)
    expect(body.all.smartGroup).toEqual([{ code: 'americas', name: 'Local', type: 'smartGroup' }])
    expect(body.all.specific[0]).toMatchObject({ code: 'us-east-1', type: 'specific' })
    expect(body.recommendations.smartGroup).toMatchObject({ code: 'americas' })
    expect(body.recommendations.specific).toHaveLength(1)
  })
})

describe('health endpoints', () => {
  it('reports the database as COMING_UP, then ACTIVE_HEALTHY, for the requested services', async () => {
    const { call, provisioner } = await buildTestApp()
    const { ref } = await json(await call('POST', '/platform/projects', NEW_PROJECT))
    const url = `/v1/projects/${ref}/health?services=auth,realtime,rest,storage,db`

    const early = await json(await call('GET', url))
    await provisioner.runOnce()
    const late = await json(await call('GET', url))

    expect(early).toEqual([{ name: 'db', healthy: false, status: 'COMING_UP' }])
    expect(late).toEqual([{ name: 'db', healthy: true, status: 'ACTIVE_HEALTHY' }])
  })

  it('reports UNHEALTHY for a failed project and 404s an unknown one', async () => {
    const { call, provisioner } = await buildTestApp({ dbFailures: 99 })
    const { ref } = await json(await call('POST', '/platform/projects', NEW_PROJECT))
    for (let i = 1; i <= 5; i++) await provisioner.runOnce(new Date(Date.now() + i * 3_600_000))

    const failed = await json(await call('GET', `/v1/projects/${ref}/health?services=db`))
    const missing = await call('GET', '/v1/projects/nope/health?services=db')

    expect(failed).toEqual([{ name: 'db', healthy: false, status: 'UNHEALTHY' }])
    expect(missing.status).toBe(404)
  })

  it('lists database statuses with the project status', async () => {
    const { call, provisioner } = await buildTestApp()
    const { ref } = await json(await call('POST', '/platform/projects', NEW_PROJECT))
    await provisioner.runOnce()

    const body = await json(await call('GET', `/platform/projects/${ref}/databases-statuses`))

    expect(body).toEqual([{ identifier: ref, status: 'ACTIVE_HEALTHY' }])
  })
})

describe('project lifecycle through the API', () => {
  it('goes COMING_UP to ACTIVE_HEALTHY as the provisioner runs', async () => {
    const { call, provisioner, dbCalls } = await buildTestApp()
    const { ref } = await json(await call('POST', '/platform/projects', NEW_PROJECT))

    expect(await json(await call('GET', `/platform/projects/${ref}/status`))).toEqual({
      status: 'COMING_UP',
    })
    await provisioner.runOnce()

    expect(await json(await call('GET', `/platform/projects/${ref}/status`))).toEqual({
      status: 'ACTIVE_HEALTHY',
    })
    expect(dbCalls).toEqual([`create:proj_${ref}`])
  })

  it('shows the new project in the list and the organization list', async () => {
    const { call } = await buildTestApp()
    const { ref } = await json(await call('POST', '/platform/projects', NEW_PROJECT))

    const all = await json(await call('GET', '/platform/projects?limit=10'))
    const org = await json(await call('GET', '/platform/organizations/default-org/projects'))

    expect(all.projects.map((p: { ref: string }) => p.ref)).toEqual([ref])
    expect(org.projects[0]).toMatchObject({ ref, status: 'COMING_UP' })
  })

  it('deletes: GOING_DOWN first, then gone with its database dropped', async () => {
    const { call, provisioner, dbCalls } = await buildTestApp()
    const { ref, id } = await json(await call('POST', '/platform/projects', NEW_PROJECT))
    await provisioner.runOnce()

    const res = await call('DELETE', `/platform/projects/${ref}`)
    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({ id, name: 'My App', ref })
    expect(await json(await call('GET', `/platform/projects/${ref}/status`))).toEqual({
      status: 'GOING_DOWN',
    })

    await provisioner.runOnce()

    expect((await call('GET', `/platform/projects/${ref}`)).status).toBe(404)
    expect(dbCalls).toEqual([`create:proj_${ref}`, `drop:proj_${ref}`])
  })

  it('404s deleting or reading the status of an unknown project', async () => {
    const { call } = await buildTestApp()

    const del = await call('DELETE', '/platform/projects/nope')
    const status = await call('GET', '/platform/projects/nope/status')

    expect(del.status).toBe(404)
    expect(await json(del)).toHaveProperty('message')
    expect(status.status).toBe(404)
  })

  it('refuses database access until the project is active, without calling postgres-meta', async () => {
    const { call, metaCalls } = await buildTestApp()
    const { ref } = await json(await call('POST', '/platform/projects', NEW_PROJECT))

    const res = await call('GET', `/platform/pg-meta/${ref}/tables`)

    expect(res.status).toBe(409)
    expect(await json(res)).toHaveProperty('message')
    expect(metaCalls).toHaveLength(0)
  })

  it('reports INIT_FAILED when provisioning keeps failing, and still allows delete', async () => {
    const { call, provisioner } = await buildTestApp({ dbFailures: 99 })
    const { ref } = await json(await call('POST', '/platform/projects', NEW_PROJECT))

    const later = (hours: number) => new Date(Date.now() + hours * 3_600_000)
    for (let i = 1; i <= 5; i++) await provisioner.runOnce(later(i))

    expect(await json(await call('GET', `/platform/projects/${ref}/status`))).toEqual({
      status: 'INIT_FAILED',
    })
    expect((await call('DELETE', `/platform/projects/${ref}`)).status).toBe(200)
  })
})
