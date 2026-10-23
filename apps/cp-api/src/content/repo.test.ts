import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createDb } from '../db/client.js'
import { migrate } from '../db/migrate.js'
import { createMemoryContentRepo } from './memoryRepo.js'
import { createContentRepo } from './pgRepo.js'
import type { ContentQuery, ContentRepo } from './ports.js'

// The same contract runs against the in-memory fake and (when CP_TEST_DATABASE_URL is set)
// a throwaway database on that server, so the fake cannot drift from Postgres.
const url = process.env['CP_TEST_DATABASE_URL']

const ALL: ContentQuery = { sortBy: 'name', sortOrder: 'asc', limit: 100, offset: 0 }
const ada = randomUUID()
const bob = randomUUID()
const REF = 'alpha'
const OTHER_REF = 'beta'

interface Harness {
  readonly repo: ContentRepo
  readonly close: () => Promise<void>
}

const memoryHarness = async (): Promise<Harness> => ({
  repo: createMemoryContentRepo(),
  close: async () => {},
})

async function pgHarness(): Promise<Harness> {
  const dbName = `cp_content_${randomUUID().replaceAll('-', '').slice(0, 12)}`
  const admin = new pg.Pool({ connectionString: url })
  await admin.query(`CREATE DATABASE ${dbName}`)

  const target = new URL(url ?? '')
  target.pathname = `/${dbName}`
  const { pool, db } = createDb(target.toString())
  await migrate(pool)
  for (const [id, email] of [
    [ada, 'ada@x.io'],
    [bob, 'bob@x.io'],
  ] as const) {
    await pool.query('INSERT INTO admins (id, email, password_hash) VALUES ($1, $2, $3)', [
      id,
      email,
      'h',
    ])
  }
  for (const ref of [REF, OTHER_REF]) {
    await pool.query(
      'INSERT INTO projects (ref, name, org_slug, db_name) VALUES ($1, $1, $2, $3)',
      [ref, 'org', `proj_${ref}`]
    )
  }
  return {
    repo: createContentRepo(db),
    close: async () => {
      await pool.end()
      await admin.query(`DROP DATABASE ${dbName} WITH (FORCE)`)
      await admin.end()
    },
  }
}

const suites: [string, () => Promise<Harness>, boolean][] = [
  ['memory content repo', memoryHarness, true],
  ['postgres content repo', pgHarness, Boolean(url)],
]

describe.each(suites)('%s', (_label, makeHarness, enabled) => {
  describe.skipIf(!enabled)('contract', () => {
    let harness: Harness
    let repo: ContentRepo
    beforeAll(async () => {
      harness = await makeHarness()
      repo = harness.repo
    })
    afterAll(async () => {
      await harness.close()
    })

    const add = (owner: string, overrides: Partial<Parameters<ContentRepo['insert']>[2]> = {}) =>
      repo.insert(REF, owner, { id: randomUUID(), type: 'sql', name: 'q', ...overrides })

    it('inserts and reads a snippet with its body', async () => {
      const row = await add(ada, { name: 'first', body: { sql: 'select 1' } })

      const got = await repo.get(REF, ada, row.id)

      expect(got).toMatchObject({
        name: 'first',
        body: { sql: 'select 1' },
        ownerId: ada,
        updatedBy: ada,
        visibility: 'user',
        favorite: false,
        folderId: null,
      })
    })

    it('hides user-visibility snippets from other admins but shares project ones', async () => {
      const mine = await add(ada, { name: 'private' })
      const shared = await add(ada, { name: 'shared', visibility: 'project' })

      expect(await repo.get(REF, bob, mine.id)).toBeNull()
      expect((await repo.get(REF, bob, shared.id))?.name).toBe('shared')
      expect((await repo.list(REF, bob, ALL)).map((r) => r.id)).not.toContain(mine.id)
      expect(await repo.update(REF, bob, mine.id, { name: 'hijack' })).toBeNull()
      expect(await repo.remove(REF, bob, [mine.id])).toEqual([])
      expect((await repo.get(REF, ada, mine.id))?.name).toBe('private')
    })

    it('scopes rows to their project', async () => {
      const row = await add(ada)

      expect(await repo.get(OTHER_REF, ada, row.id)).toBeNull()
      expect(await repo.remove(OTHER_REF, ada, [row.id])).toEqual([])
    })

    it('allows the same id in two projects', async () => {
      const id = randomUUID()
      await repo.insert(REF, ada, { id, type: 'sql', name: 'a' })
      await repo.insert(OTHER_REF, ada, { id, type: 'sql', name: 'b' })

      expect((await repo.get(REF, ada, id))?.name).toBe('a')
      expect((await repo.get(OTHER_REF, ada, id))?.name).toBe('b')
    })

    it('updates only the given fields and records who changed it', async () => {
      const row = await add(ada, { name: 'old', body: { sql: 'x' }, visibility: 'project' })

      const next = await repo.update(REF, bob, row.id, { name: 'new', favorite: true })

      expect(next).toMatchObject({
        name: 'new',
        favorite: true,
        body: { sql: 'x' },
        ownerId: ada,
        updatedBy: bob,
      })
      expect(next?.updatedAt.getTime()).toBeGreaterThanOrEqual(row.updatedAt.getTime())
    })

    it('clears the folder and description with null', async () => {
      const folder = await repo.insertFolder(REF, ada, { name: 'f', parentId: null })
      const row = await add(ada, { folderId: folder.id, description: 'd' })

      const next = await repo.update(REF, ada, row.id, { folderId: null, description: null })

      expect(next).toMatchObject({ folderId: null, description: null })
    })

    it('filters, sorts and pages', async () => {
      for (const [name, favorite] of [
        ['b-one', false],
        ['a-two', true],
        ['c-three', false],
      ] as const) {
        await repo.insert(OTHER_REF, ada, { id: randomUUID(), type: 'report', name, favorite })
      }
      const names = async (extra: Partial<ContentQuery>) =>
        (await repo.list(OTHER_REF, ada, { ...ALL, type: 'report', ...extra })).map((x) => x.name)

      expect(await names({})).toEqual(['a-two', 'b-one', 'c-three'])
      expect(await names({ sortOrder: 'desc' })).toEqual(['c-three', 'b-one', 'a-two'])
      expect(await names({ limit: 2, offset: 1 })).toEqual(['b-one', 'c-three'])
      expect(await names({ favorite: true })).toEqual(['a-two'])
      expect(await names({ name: 'THREE' })).toEqual(['c-three'])
      expect(await names({ name: '%' })).toEqual([])
    })

    it('counts favorites, private and shared', async () => {
      await repo.insert(OTHER_REF, ada, {
        id: randomUUID(),
        type: 'notebook',
        name: 'n1',
        favorite: true,
      })
      await repo.insert(OTHER_REF, ada, {
        id: randomUUID(),
        type: 'notebook',
        name: 'n2',
        visibility: 'project',
      })

      expect(await repo.count(OTHER_REF, ada, { type: 'notebook' })).toEqual({
        favorites: 1,
        private: 1,
        shared: 1,
      })
      expect(await repo.count(OTHER_REF, bob, { type: 'notebook' })).toEqual({
        favorites: 0,
        private: 0,
        shared: 1,
      })
    })

    it('removes only existing ids', async () => {
      const row = await add(ada)

      expect(await repo.remove(REF, ada, [row.id, randomUUID()])).toEqual([row.id])
      expect(await repo.remove(REF, ada, [])).toEqual([])
    })

    it('keeps folders private to their owner and nests them', async () => {
      const parent = await repo.insertFolder(REF, ada, { name: 'Parent', parentId: null })
      const child = await repo.insertFolder(REF, ada, { name: 'Child', parentId: parent.id })

      const root = await repo.listFolders(REF, ada, { parentId: null })
      const inside = await repo.listFolders(REF, ada, { parentId: parent.id })

      expect(root.map((f) => f.id)).toContain(parent.id)
      expect(root.map((f) => f.id)).not.toContain(child.id)
      expect(inside.map((f) => f.id)).toEqual([child.id])
      expect(await repo.getFolder(REF, bob, parent.id)).toBeNull()
      expect(await repo.listFolders(REF, bob, { parentId: null })).toEqual([])
      expect(await repo.renameFolder(REF, bob, parent.id, 'x')).toBeNull()
      expect((await repo.renameFolder(REF, ada, parent.id, 'Renamed'))?.name).toBe('Renamed')
    })

    it('searches folder names at any depth', async () => {
      const top = await repo.insertFolder(REF, ada, { name: 'zz-top', parentId: null })
      const deep = await repo.insertFolder(REF, ada, { name: 'zz-deep', parentId: top.id })

      const found = await repo.listFolders(REF, ada, { parentId: null, name: 'ZZ-' })

      expect(found.map((f) => f.id).sort()).toEqual([top.id, deep.id].sort())
    })

    it('deleting a folder deletes subfolders and snippets, but only for the owner', async () => {
      const parent = await repo.insertFolder(REF, ada, { name: 'P', parentId: null })
      const child = await repo.insertFolder(REF, ada, { name: 'C', parentId: parent.id })
      const row = await add(ada, { folderId: child.id })

      expect(await repo.removeFolders(REF, bob, [parent.id])).toEqual([])
      expect(await repo.removeFolders(REF, ada, [parent.id, randomUUID()])).toEqual([parent.id])

      expect(await repo.getFolder(REF, ada, child.id)).toBeNull()
      expect(await repo.get(REF, ada, row.id)).toBeNull()
    })
  })
})
