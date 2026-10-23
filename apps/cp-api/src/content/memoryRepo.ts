import { randomUUID } from 'node:crypto'

import type { ContentPatch, ContentRepo, ContentRow, FolderRow } from './ports.js'

const matchesName = (name: string, needle: string | undefined) =>
  needle === undefined || name.toLowerCase().includes(needle.toLowerCase())

/** In-memory repo for unit tests; pgRepo implements the same port. */
export function createMemoryContentRepo(now: () => Date = () => new Date()): ContentRepo {
  const rows = new Map<string, ContentRow>()
  const folders = new Map<string, FolderRow>()
  const key = (ref: string, id: string) => `${ref}/${id}`

  const visible = (r: ContentRow, viewer: string) => r.visibility !== 'user' || r.ownerId === viewer
  const visibleRow = (ref: string, viewer: string, id: string) => {
    const row = rows.get(key(ref, id))
    return row && visible(row, viewer) ? row : null
  }
  const ownFolder = (ref: string, viewer: string, id: string) => {
    const f = folders.get(id)
    return f && f.projectRef === ref && f.ownerId === viewer ? f : null
  }

  return {
    async list(ref, viewer, q) {
      const matched = [...rows.values()].filter(
        (r) =>
          r.projectRef === ref &&
          visible(r, viewer) &&
          (q.type === undefined || r.type === q.type) &&
          (q.favorite === undefined || r.favorite === q.favorite) &&
          (q.visibility === undefined || r.visibility === q.visibility) &&
          (q.folderId === undefined || r.folderId === q.folderId) &&
          matchesName(r.name, q.name)
      )
      const dir = q.sortOrder === 'asc' ? 1 : -1
      const sorted = matched.sort((a, b) =>
        q.sortBy === 'name'
          ? dir * a.name.localeCompare(b.name)
          : dir * (a.insertedAt.getTime() - b.insertedAt.getTime())
      )
      return sorted.slice(q.offset, q.offset + q.limit)
    },

    async get(ref, viewer, id) {
      return visibleRow(ref, viewer, id)
    },

    async insert(ref, owner, input) {
      const at = now()
      const row: ContentRow = {
        id: input.id,
        projectRef: ref,
        ownerId: owner,
        updatedBy: owner,
        type: input.type,
        visibility: input.visibility ?? 'user',
        name: input.name,
        description: input.description ?? null,
        favorite: input.favorite ?? false,
        folderId: input.folderId ?? null,
        body: input.body ?? null,
        insertedAt: at,
        updatedAt: at,
      }
      if (rows.has(key(ref, row.id))) throw new Error('duplicate content id')
      rows.set(key(ref, row.id), row)
      return row
    },

    async update(ref, viewer, id, patch: ContentPatch) {
      const row = visibleRow(ref, viewer, id)
      if (!row) return null
      const next: ContentRow = {
        ...row,
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.description !== undefined && { description: patch.description }),
        ...(patch.favorite !== undefined && { favorite: patch.favorite }),
        ...(patch.folderId !== undefined && { folderId: patch.folderId }),
        ...(patch.visibility !== undefined && { visibility: patch.visibility }),
        ...(patch.body !== undefined && { body: patch.body }),
        updatedBy: viewer,
        updatedAt: now(),
      }
      rows.set(key(ref, id), next)
      return next
    },

    async remove(ref, viewer, ids) {
      const deleted = ids.filter((id) => visibleRow(ref, viewer, id))
      for (const id of deleted) rows.delete(key(ref, id))
      return deleted
    },

    async count(ref, viewer, filter) {
      const mine = [...rows.values()].filter(
        (r) =>
          r.projectRef === ref &&
          visible(r, viewer) &&
          (filter.type === undefined || r.type === filter.type) &&
          matchesName(r.name, filter.name)
      )
      return {
        favorites: mine.filter((r) => r.favorite).length,
        private: mine.filter((r) => r.visibility === 'user').length,
        shared: mine.filter((r) => r.visibility !== 'user').length,
      }
    },

    async listFolders(ref, viewer, { parentId, name }) {
      return [...folders.values()]
        .filter(
          (f) =>
            f.projectRef === ref &&
            f.ownerId === viewer &&
            (name !== undefined || f.parentId === parentId) &&
            matchesName(f.name, name)
        )
        .sort((a, b) => a.name.localeCompare(b.name))
    },

    async getFolder(ref, viewer, id) {
      return ownFolder(ref, viewer, id)
    },

    async insertFolder(ref, owner, { name, parentId }) {
      const folder: FolderRow = {
        id: randomUUID(),
        projectRef: ref,
        ownerId: owner,
        name,
        parentId,
      }
      folders.set(folder.id, folder)
      return folder
    },

    async renameFolder(ref, viewer, id, name) {
      const folder = ownFolder(ref, viewer, id)
      if (!folder) return null
      const next = { ...folder, name }
      folders.set(id, next)
      return next
    },

    async removeFolders(ref, viewer, ids) {
      const deleted: string[] = []
      const drop = (id: string) => {
        folders.delete(id)
        for (const [k, r] of rows) if (r.folderId === id) rows.delete(k)
        for (const child of [...folders.values()]) if (child.parentId === id) drop(child.id)
      }
      for (const id of ids) {
        if (!ownFolder(ref, viewer, id)) continue
        deleted.push(id)
        drop(id)
      }
      return deleted
    },
  }
}
