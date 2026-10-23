import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'

import { buildTestApp } from '../../test/appKit.js'

const SECRETS = {
  jwtSecret: 'j',
  dbPassword: 'p',
  anonKey: 'a',
  serviceKey: 's',
  dbUser: 'postgres',
}
const base = (ref: string) => `/platform/projects/${ref}/content`

type Kit = Awaited<ReturnType<typeof buildTestApp>>

async function addProject(kit: Kit, ref: string) {
  await kit.registry.register(
    { ref, name: ref, orgSlug: 'default-org', dbName: `proj_${ref}`, status: 'ACTIVE_HEALTHY' },
    SECRETS
  )
}

const snippet = (overrides: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  name: 'My query',
  type: 'sql',
  visibility: 'user',
  content: { sql: 'select 1', schema_version: '1' },
  ...overrides,
})

describe('content routes', () => {
  let kit: Kit
  beforeEach(async () => {
    kit = await buildTestApp()
    await addProject(kit, 'alpha')
    await addProject(kit, 'beta')
  })

  it('requires an admin token', async () => {
    const res = await kit.call('GET', base('alpha'), undefined, false)
    expect(res.status).toBe(401)
  })

  it('404s for an unknown project', async () => {
    const res = await kit.call('GET', base('nope'))
    expect(res.status).toBe(404)
    expect(await res.json()).toHaveProperty('message')
  })

  it('creates a snippet and reads it back with owner details', async () => {
    const body = snippet()

    const put = await kit.call('PUT', base('alpha'), body)
    const got = await kit.call('GET', `${base('alpha')}/item/${body.id}`)

    expect(put.status).toBe(200)
    const item = (await got.json()) as Record<string, unknown>
    expect(item).toMatchObject({
      id: body.id,
      name: 'My query',
      type: 'sql',
      favorite: false,
      folder_id: null,
      content: { sql: 'select 1' },
      owner: { username: 'ada' },
      updated_by: { username: 'ada' },
    })
    expect(typeof item['project_id']).toBe('number')
  })

  it('rejects a new snippet without name or type', async () => {
    const res = await kit.call('PUT', base('alpha'), { id: randomUUID() })
    expect(res.status).toBe(400)
    expect(await res.json()).toHaveProperty('message')
  })

  it('rejects a malformed id', async () => {
    const res = await kit.call('PUT', base('alpha'), snippet({ id: 'not-a-uuid' }))
    expect(res.status).toBe(400)
  })

  it('updates in place and keeps the body when only the name changes', async () => {
    const body = snippet()
    await kit.call('PUT', base('alpha'), body)

    await kit.call('PUT', base('alpha'), { id: body.id, name: 'Renamed' })

    const item = (await (await kit.call('GET', `${base('alpha')}/item/${body.id}`)).json()) as {
      name: string
      content: unknown
    }
    expect(item.name).toBe('Renamed')
    expect(item.content).toEqual(body.content)
  })

  it('keeps projects apart', async () => {
    const body = snippet()
    await kit.call('PUT', base('alpha'), body)

    const other = await kit.call('GET', `${base('beta')}/item/${body.id}`)
    const list = (await (await kit.call('GET', base('beta'))).json()) as { data: unknown[] }

    expect(other.status).toBe(404)
    expect(list.data).toEqual([])
  })

  it('pages the list with a cursor', async () => {
    for (const n of ['a', 'b', 'c']) await kit.call('PUT', base('alpha'), snippet({ name: n }))

    const first = (await (
      await kit.call('GET', `${base('alpha')}?limit=2&sort_by=name&sort_order=asc`)
    ).json()) as { data: { name: string }[]; cursor?: string }
    const second = (await (
      await kit.call(
        'GET',
        `${base('alpha')}?limit=2&sort_by=name&sort_order=asc&cursor=${first.cursor}`
      )
    ).json()) as { data: { name: string }[]; cursor?: string }

    expect(first.data.map((d) => d.name)).toEqual(['a', 'b'])
    expect(first.cursor).toBe('2')
    expect(second.data.map((d) => d.name)).toEqual(['c'])
    expect(second.cursor).toBeUndefined()
  })

  it('filters by name and type', async () => {
    await kit.call('PUT', base('alpha'), snippet({ name: 'Users report' }))
    await kit.call('PUT', base('alpha'), snippet({ name: 'Orders', type: 'report', content: {} }))

    const res = (await (await kit.call('GET', `${base('alpha')}?type=sql&name=user`)).json()) as {
      data: { name: string }[]
    }

    expect(res.data.map((d) => d.name)).toEqual(['Users report'])
  })

  it('counts favorites and private snippets', async () => {
    await kit.call('PUT', base('alpha'), snippet({ favorite: true }))
    await kit.call('PUT', base('alpha'), snippet())
    await kit.call('PUT', base('alpha'), snippet({ visibility: 'project' }))

    const res = await kit.call('GET', `${base('alpha')}/count?type=sql`)

    expect(await res.json()).toEqual({ favorites: 1, private: 2, shared: 1 })
  })

  it('deletes by ids and reports which were deleted', async () => {
    const body = snippet()
    await kit.call('PUT', base('alpha'), body)
    const ghost = randomUUID()

    const res = await kit.call('DELETE', `${base('alpha')}?ids=${body.id},${ghost}`)

    expect(await res.json()).toEqual([{ id: body.id }])
    expect((await kit.call('GET', `${base('alpha')}/item/${body.id}`)).status).toBe(404)
  })

  it('requires ids to delete', async () => {
    expect((await kit.call('DELETE', base('alpha'))).status).toBe(400)
  })

  describe('folders', () => {
    const createFolder = async (name: string, parentId?: string) => {
      const res = await kit.call('POST', `${base('alpha')}/folders`, {
        name,
        ...(parentId && { parentId }),
      })
      return (await res.json()) as { id: string; name: string; parent_id: string | null }
    }
    const listing = async (path = '') =>
      (await (await kit.call('GET', `${base('alpha')}/folders${path}`)).json()) as {
        data: { folders: { id: string; name: string }[]; contents: { id: string }[] }
      }

    it('creates a folder and lists it at the root', async () => {
      const folder = await createFolder('Reports')

      expect(folder).toMatchObject({ name: 'Reports', parent_id: null })
      expect((await listing()).data.folders.map((f) => f.name)).toEqual(['Reports'])
    })

    it('moves a snippet into a folder and back to the root', async () => {
      const folder = await createFolder('Reports')
      const body = snippet()
      await kit.call('PUT', base('alpha'), body)

      await kit.call('PUT', base('alpha'), { id: body.id, folder_id: folder.id })
      const inside = await listing(`/${folder.id}`)
      const root = await listing()

      expect(inside.data.contents.map((c) => c.id)).toEqual([body.id])
      expect(root.data.contents).toEqual([])

      await kit.call('PUT', base('alpha'), { id: body.id, folder_id: null })
      expect((await listing()).data.contents.map((c) => c.id)).toEqual([body.id])
    })

    it('nests folders', async () => {
      const parent = await createFolder('Parent')
      const child = await createFolder('Child', parent.id)

      const inside = await listing(`/${parent.id}`)

      expect(child.parent_id).toBe(parent.id)
      expect(inside.data.folders.map((f) => f.name)).toEqual(['Child'])
      expect((await listing()).data.folders.map((f) => f.name)).toEqual(['Parent'])
    })

    it('renames a folder', async () => {
      const folder = await createFolder('Old')

      const res = await kit.call('PATCH', `${base('alpha')}/folders/${folder.id}`, { name: 'New' })

      expect(await res.json()).toMatchObject({ id: folder.id, name: 'New' })
    })

    it('deleting a folder deletes its snippets', async () => {
      const folder = await createFolder('Doomed')
      const body = snippet({ folder_id: folder.id })
      await kit.call('PUT', base('alpha'), body)

      await kit.call('DELETE', `${base('alpha')}/folders?ids=${folder.id}`)

      expect((await kit.call('GET', `${base('alpha')}/item/${body.id}`)).status).toBe(404)
      expect((await listing()).data.folders).toEqual([])
    })

    it('404s for an unknown folder or parent', async () => {
      const ghost = randomUUID()

      expect((await kit.call('GET', `${base('alpha')}/folders/${ghost}`)).status).toBe(404)
      expect(
        (await kit.call('POST', `${base('alpha')}/folders`, { name: 'x', parentId: ghost })).status
      ).toBe(404)
      expect(
        (await kit.call('PATCH', `${base('alpha')}/folders/${ghost}`, { name: 'x' })).status
      ).toBe(404)
    })

    it('searches snippets and folders at any depth', async () => {
      const parent = await createFolder('Parent')
      await createFolder('Needle folder', parent.id)
      await kit.call('PUT', base('alpha'), snippet({ name: 'Needle query', folder_id: parent.id }))

      const found = await listing('?name=needle')

      expect(found.data.folders.map((f) => f.name)).toEqual(['Needle folder'])
      expect(found.data.contents).toHaveLength(1)
    })
  })
})
