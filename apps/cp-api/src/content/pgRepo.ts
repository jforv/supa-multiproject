import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm'

import type { Db } from '../db/client.js'
import { content, contentFolders } from '../db/schema.js'
import type { ContentPatch, ContentRepo, ContentRow, FolderRow } from './ports.js'

const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&')
const containsName = (column: typeof content.name | typeof contentFolders.name, needle: string) =>
  ilike(column, `%${escapeLike(needle)}%`)

// ponytail: type/visibility are text columns guarded by CHECK constraints, so the cast is safe.
const toRow = (r: typeof content.$inferSelect): ContentRow => ({
  ...r,
  type: r.type as ContentRow['type'],
  visibility: r.visibility as ContentRow['visibility'],
})

const toFolder = (r: typeof contentFolders.$inferSelect): FolderRow => ({
  id: r.id,
  projectRef: r.projectRef,
  ownerId: r.ownerId,
  name: r.name,
  parentId: r.parentId,
})

export function createContentRepo(db: Db): ContentRepo {
  const visibleTo = (viewer: string) =>
    or(ne(content.visibility, 'user'), eq(content.ownerId, viewer))
  const rowKey = (ref: string, viewer: string, id: string) =>
    and(eq(content.projectRef, ref), eq(content.id, id), visibleTo(viewer))
  const folderKey = (ref: string, viewer: string, id: string) =>
    and(
      eq(contentFolders.projectRef, ref),
      eq(contentFolders.ownerId, viewer),
      eq(contentFolders.id, id)
    )

  function patchColumns(patch: ContentPatch) {
    return {
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.description !== undefined && { description: patch.description }),
      ...(patch.favorite !== undefined && { favorite: patch.favorite }),
      ...(patch.folderId !== undefined && { folderId: patch.folderId }),
      ...(patch.visibility !== undefined && { visibility: patch.visibility }),
      ...(patch.body !== undefined && { body: patch.body }),
    }
  }

  return {
    async list(ref, viewer, q) {
      const order = q.sortOrder === 'asc' ? asc : desc
      const rows = await db
        .select()
        .from(content)
        .where(
          and(
            eq(content.projectRef, ref),
            visibleTo(viewer),
            q.type !== undefined ? eq(content.type, q.type) : undefined,
            q.favorite !== undefined ? eq(content.favorite, q.favorite) : undefined,
            q.visibility !== undefined ? eq(content.visibility, q.visibility) : undefined,
            q.folderId === undefined
              ? undefined
              : q.folderId === null
                ? isNull(content.folderId)
                : eq(content.folderId, q.folderId),
            q.name !== undefined ? containsName(content.name, q.name) : undefined
          )
        )
        .orderBy(order(q.sortBy === 'name' ? content.name : content.insertedAt), asc(content.id))
        .limit(q.limit)
        .offset(q.offset)
      return rows.map(toRow)
    },

    async get(ref, viewer, id) {
      const [row] = await db
        .select()
        .from(content)
        .where(rowKey(ref, viewer, id))
      return row ? toRow(row) : null
    },

    async insert(ref, owner, input) {
      const [row] = await db
        .insert(content)
        .values({
          projectRef: ref,
          id: input.id,
          ownerId: owner,
          updatedBy: owner,
          type: input.type,
          name: input.name,
          ...patchColumns(input),
        })
        .returning()
      if (!row) throw new Error('content insert returned no row')
      return toRow(row)
    },

    async update(ref, viewer, id, patch) {
      const [row] = await db
        .update(content)
        .set({ ...patchColumns(patch), updatedBy: viewer, updatedAt: new Date() })
        .where(rowKey(ref, viewer, id))
        .returning()
      return row ? toRow(row) : null
    },

    async remove(ref, viewer, ids) {
      if (ids.length === 0) return []
      const rows = await db
        .delete(content)
        .where(and(eq(content.projectRef, ref), visibleTo(viewer), inArray(content.id, [...ids])))
        .returning({ id: content.id })
      return rows.map((r) => r.id)
    },

    async count(ref, viewer, filter) {
      const [row] = await db
        .select({
          favorites: sql<number>`count(*) filter (where ${content.favorite})`.mapWith(Number),
          private: sql<number>`count(*) filter (where ${content.visibility} = 'user')`.mapWith(
            Number
          ),
          shared: sql<number>`count(*) filter (where ${content.visibility} <> 'user')`.mapWith(
            Number
          ),
        })
        .from(content)
        .where(
          and(
            eq(content.projectRef, ref),
            visibleTo(viewer),
            filter.type !== undefined ? eq(content.type, filter.type) : undefined,
            filter.name !== undefined ? containsName(content.name, filter.name) : undefined
          )
        )
      return row ?? { favorites: 0, private: 0, shared: 0 }
    },

    async listFolders(ref, viewer, { parentId, name }) {
      const rows = await db
        .select()
        .from(contentFolders)
        .where(
          and(
            eq(contentFolders.projectRef, ref),
            eq(contentFolders.ownerId, viewer),
            // A search looks through every level; browsing only one.
            name !== undefined
              ? containsName(contentFolders.name, name)
              : parentId === null
                ? isNull(contentFolders.parentId)
                : eq(contentFolders.parentId, parentId)
          )
        )
        .orderBy(asc(contentFolders.name), asc(contentFolders.id))
      return rows.map(toFolder)
    },

    async getFolder(ref, viewer, id) {
      const [row] = await db
        .select()
        .from(contentFolders)
        .where(folderKey(ref, viewer, id))
      return row ? toFolder(row) : null
    },

    async insertFolder(ref, owner, { name, parentId }) {
      const [row] = await db
        .insert(contentFolders)
        .values({ projectRef: ref, ownerId: owner, name, parentId })
        .returning()
      if (!row) throw new Error('folder insert returned no row')
      return toFolder(row)
    },

    async renameFolder(ref, viewer, id, name) {
      const [row] = await db
        .update(contentFolders)
        .set({ name })
        .where(folderKey(ref, viewer, id))
        .returning()
      return row ? toFolder(row) : null
    },

    async removeFolders(ref, viewer, ids) {
      if (ids.length === 0) return []
      const rows = await db
        .delete(contentFolders)
        .where(
          and(
            eq(contentFolders.projectRef, ref),
            eq(contentFolders.ownerId, viewer),
            inArray(contentFolders.id, [...ids])
          )
        )
        .returning({ id: contentFolders.id })
      return rows.map((r) => r.id)
    },
  }
}
