import { Hono, type Context } from 'hono'
import { z } from 'zod'

import type { AdminRepo } from '../auth/ports.js'
import type { ContentPatch, ContentRepo, ContentRow } from '../content/ports.js'
import { contentDetail, contentSummary, folderBody, personResolver } from '../content/wire.js'
import type { AppEnv } from '../http/app.js'
import { ApiError } from '../http/errors.js'
import type { ProjectRegistry } from '../registry/registry.js'

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500
const MAX_NAME_LENGTH = 255

const contentType = z.enum(['sql', 'report', 'log_sql', 'notebook'])
const visibility = z.enum(['user', 'project', 'org', 'public'])
// Studio sends booleans as strings, in any of these spellings.
const FALSY = ['false', '0', 'no', 'off', 'n', 'disabled']
const TRUTHY = ['true', '1', 'yes', 'on', 'y', 'enabled']
const flag = z.enum([...TRUTHY, ...FALSY] as [string, ...string[]])

const listQuery = z.object({
  type: contentType.optional(),
  name: z.string().min(1).optional(),
  visibility: visibility.optional(),
  favorite: flag.optional(),
  sort_by: z.enum(['name', 'inserted_at']).default('inserted_at'),
  sort_order: z.enum(['asc', 'desc']).default('desc'),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  cursor: z.coerce.number().int().min(0).default(0),
})
type ListQuery = z.infer<typeof listQuery>

const countQuery = z.object({ type: contentType.optional(), name: z.string().min(1).optional() })

const name = z.string().trim().min(1).max(MAX_NAME_LENGTH)
const upsertBody = z.object({
  id: z.uuid(),
  name: name.optional(),
  type: contentType.optional(),
  description: z.string().nullable().optional(),
  favorite: z.boolean().optional(),
  folder_id: z.uuid().nullable().optional(),
  visibility: visibility.optional(),
  content: z.record(z.string(), z.unknown()).nullable().optional(),
})
const createFolderBody = z.object({
  name,
  parentId: z.uuid().nullish(),
  parent_id: z.uuid().nullish(),
})
const renameFolderBody = z.object({ name })
const idsQuery = z.object({ ids: z.string().min(1, 'ids is required') })

function parse<S extends z.ZodType>(schema: S, raw: unknown): z.infer<S> {
  const parsed = schema.safeParse(raw)
  if (parsed.success) return parsed.data
  const issue = parsed.error.issues[0]
  const where = issue?.path.length ? ` (${issue.path.join('.')})` : ''
  throw new ApiError(400, `Invalid request: ${issue?.message ?? 'bad input'}${where}`)
}

const parseIds = (raw: unknown): string[] =>
  parse(idsQuery, raw)
    .ids.split(',')
    .filter((id) => id.length > 0)

const isUuid = (s: string) => z.uuid().safeParse(s).success

const toPatch = (b: z.infer<typeof upsertBody>): ContentPatch => ({
  ...(b.name !== undefined && { name: b.name }),
  ...(b.description !== undefined && { description: b.description }),
  ...(b.favorite !== undefined && { favorite: b.favorite }),
  ...(b.folder_id !== undefined && { folderId: b.folder_id }),
  ...(b.visibility !== undefined && { visibility: b.visibility }),
  ...(b.content !== undefined && { body: b.content }),
})

export interface ContentDeps {
  readonly content: ContentRepo
  readonly admins: AdminRepo
  readonly registry: ProjectRegistry
}

export function contentRoutes({ content, admins, registry }: ContentDeps) {
  const routes = new Hono<AppEnv>()
  const base = '/platform/projects/:ref/content'

  async function scope(c: Context<AppEnv>) {
    const ref = c.req.param('ref') ?? ''
    const project = await registry.get(ref)
    if (!project) throw new ApiError(404, `Project "${ref}" not found`)
    return { ref: project.ref, projectId: project.id, viewer: c.get('admin').sub }
  }

  /** Fetches one extra row to learn whether another page exists. */
  async function page(
    ref: string,
    viewer: string,
    q: ListQuery,
    extra: { folderId?: string | null }
  ): Promise<{ rows: ContentRow[]; cursor?: string }> {
    const rows = await content.list(ref, viewer, {
      ...(q.type !== undefined && { type: q.type }),
      ...(q.name !== undefined && { name: q.name }),
      ...(q.visibility !== undefined && { visibility: q.visibility }),
      ...(q.favorite !== undefined && { favorite: !FALSY.includes(q.favorite) }),
      ...(extra.folderId !== undefined && { folderId: extra.folderId }),
      sortBy: q.sort_by,
      sortOrder: q.sort_order,
      limit: q.limit + 1,
      offset: q.cursor,
    })
    const more = rows.length > q.limit
    return { rows: rows.slice(0, q.limit), ...(more && { cursor: String(q.cursor + q.limit) }) }
  }

  routes.get(base, async (c) => {
    const { ref, projectId, viewer } = await scope(c)
    const q = parse(listQuery, c.req.query())
    const { rows, cursor } = await page(ref, viewer, q, {})
    const who = personResolver(admins)
    const data = await Promise.all(rows.map((r) => contentDetail(r, projectId, who)))
    return c.json({ data, ...(cursor !== undefined && { cursor }) })
  })

  routes.put(base, async (c) => {
    const { ref, projectId, viewer } = await scope(c)
    const body = parse(upsertBody, await c.req.json().catch(() => null))
    const patch = toPatch(body)
    let saved: ContentRow | null
    if (await content.get(ref, viewer, body.id)) {
      saved = await content.update(ref, viewer, body.id, patch)
    } else {
      if (body.name === undefined || body.type === undefined) {
        throw new ApiError(400, 'Invalid request: name and type are required for new content')
      }
      saved = await content.insert(ref, viewer, {
        ...patch,
        id: body.id,
        name: body.name,
        type: body.type,
      })
    }
    if (!saved) throw new ApiError(404, `Content "${body.id}" not found`)
    return c.json(await contentDetail(saved, projectId, personResolver(admins)))
  })

  routes.delete(base, async (c) => {
    const { ref, viewer } = await scope(c)
    const ids = parseIds(c.req.query()).filter(isUuid)
    const deleted = await content.remove(ref, viewer, ids)
    return c.json(deleted.map((id) => ({ id })))
  })

  routes.get(`${base}/count`, async (c) => {
    const { ref, viewer } = await scope(c)
    const filter = parse(countQuery, c.req.query())
    return c.json(
      await content.count(ref, viewer, {
        ...(filter.type !== undefined && { type: filter.type }),
        ...(filter.name !== undefined && { name: filter.name }),
      })
    )
  })

  routes.get(`${base}/item/:id`, async (c) => {
    const { ref, projectId, viewer } = await scope(c)
    const id = c.req.param('id')
    const row = isUuid(id) ? await content.get(ref, viewer, id) : null
    if (!row) throw new ApiError(404, `Content "${id}" not found`)
    return c.json(await contentDetail(row, projectId, personResolver(admins)))
  })

  /** Folders and snippets directly under `parentId`, or matching a search at any depth. */
  async function listing(c: Context<AppEnv>, parentId: string | null) {
    const { ref, projectId, viewer } = await scope(c)
    const q = parse(listQuery, c.req.query())
    const searching = q.name !== undefined
    const { rows, cursor } = await page(ref, viewer, q, searching ? {} : { folderId: parentId })
    // Folders only ride along on the first page so paging through snippets never repeats them.
    const folders =
      q.cursor > 0
        ? []
        : await content.listFolders(ref, viewer, {
            parentId,
            ...(q.name !== undefined && { name: q.name }),
          })
    return c.json({
      data: {
        folders: folders.map((f) => folderBody(f, projectId)),
        contents: rows.map((r) => contentSummary(r, projectId)),
      },
      ...(cursor !== undefined && { cursor }),
    })
  }

  routes.get(`${base}/folders`, (c) => listing(c, null))

  routes.post(`${base}/folders`, async (c) => {
    const { ref, projectId, viewer } = await scope(c)
    const body = parse(createFolderBody, await c.req.json().catch(() => null))
    const parentId = body.parentId ?? body.parent_id ?? null
    if (parentId !== null && !(await content.getFolder(ref, viewer, parentId))) {
      throw new ApiError(404, `Folder "${parentId}" not found`)
    }
    const folder = await content.insertFolder(ref, viewer, { name: body.name, parentId })
    return c.json(folderBody(folder, projectId), 201)
  })

  routes.delete(`${base}/folders`, async (c) => {
    const { ref, viewer } = await scope(c)
    await content.removeFolders(ref, viewer, parseIds(c.req.query()).filter(isUuid))
    return c.json({})
  })

  routes.get(`${base}/folders/:id`, async (c) => {
    const { ref, viewer } = await scope(c)
    const id = c.req.param('id')
    if (!isUuid(id) || !(await content.getFolder(ref, viewer, id))) {
      throw new ApiError(404, `Folder "${id}" not found`)
    }
    return listing(c, id)
  })

  routes.patch(`${base}/folders/:id`, async (c) => {
    const { ref, projectId, viewer } = await scope(c)
    const id = c.req.param('id')
    const { name: newName } = parse(renameFolderBody, await c.req.json().catch(() => null))
    const folder = isUuid(id) ? await content.renameFolder(ref, viewer, id, newName) : null
    if (!folder) throw new ApiError(404, `Folder "${id}" not found`)
    return c.json(folderBody(folder, projectId))
  })

  return routes
}
