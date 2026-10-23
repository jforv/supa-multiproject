import type { AdminRepo } from '../auth/ports.js'
import type { ContentRow, FolderRow } from './ports.js'

/**
 * Studio addresses people by a numeric id; admins are keyed by uuid. The first 31 bits of
 * the uuid are stable and collision-free enough for a handful of admins.
 */
export const numericId = (uuid: string): number =>
  Number.parseInt(uuid.slice(0, 8), 16) & 0x7fffffff

export interface Person {
  readonly id: number
  readonly username: string
}

/** Resolves admin uuids to Studio people, remembering lookups for the length of one request. */
export function personResolver(admins: AdminRepo): (uuid: string) => Promise<Person> {
  const seen = new Map<string, Promise<Person>>()
  return (uuid) => {
    const known = seen.get(uuid)
    if (known) return known
    const person = admins.findById(uuid).then((a) => ({
      id: numericId(uuid),
      username: a ? (a.email.split('@')[0] ?? a.email) : 'unknown',
    }))
    seen.set(uuid, person)
    return person
  }
}

/** The fields shared by the list and detail shapes. */
export const contentSummary = (row: ContentRow, projectId: number) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  type: row.type,
  visibility: row.visibility,
  favorite: row.favorite,
  folder_id: row.folderId,
  project_id: projectId,
  owner_id: numericId(row.ownerId),
  last_updated_by: row.updatedBy === null ? null : numericId(row.updatedBy),
  inserted_at: row.insertedAt.toISOString(),
  updated_at: row.updatedAt.toISOString(),
})

export async function contentDetail(
  row: ContentRow,
  projectId: number,
  who: (uuid: string) => Promise<Person>
) {
  return {
    ...contentSummary(row, projectId),
    content: row.body,
    owner: await who(row.ownerId),
    updated_by: row.updatedBy === null ? null : await who(row.updatedBy),
  }
}

export const folderBody = (folder: FolderRow, projectId: number) => ({
  id: folder.id,
  name: folder.name,
  owner_id: numericId(folder.ownerId),
  parent_id: folder.parentId,
  project_id: projectId,
})
