import { randomInt } from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'

import { generateProjectSecrets } from '../crypto/projectKeys.js'
import type { AppEnv } from '../http/app.js'
import { ApiError } from '../http/errors.js'
import type { ProjectRegistry } from '../registry/registry.js'
import { createdProjectBody, type ShapeContext } from './platformShapes.js'

const REF_LENGTH = 20
const REF_ALPHABET = 'abcdefghijklmnopqrstuvwxyz'
const MAX_NAME_LENGTH = 64

const createBody = z.object({
  name: z.string().trim().min(1, 'name is required').max(MAX_NAME_LENGTH),
  organization_slug: z.string().min(1, 'organization_slug is required'),
})

export interface LifecycleDeps {
  readonly registry: ProjectRegistry
  readonly ctx: ShapeContext
  /** Credentials every project's database is reached with (shared cluster role, for now). */
  readonly newProjectDb: { readonly user: string; readonly password: string }
}

/** Same shape as Supabase project refs: 20 lowercase letters. */
const newRef = () =>
  Array.from({ length: REF_LENGTH }, () => REF_ALPHABET[randomInt(REF_ALPHABET.length)]).join('')

export function lifecycleRoutes({ registry, ctx, newProjectDb }: LifecycleDeps) {
  const routes = new Hono<AppEnv>()

  routes.post('/platform/projects', async (c) => {
    const raw: unknown = await c.req.json().catch(() => ({}))
    const parsed = createBody.safeParse(raw)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      throw new ApiError(400, `Invalid request: ${issue?.message ?? 'bad body'}`)
    }
    const { name, organization_slug } = parsed.data
    if (organization_slug !== ctx.org.slug) {
      throw new ApiError(400, `Unknown organization "${organization_slug}"`)
    }

    const ref = newRef()
    const secrets = {
      ...(await generateProjectSecrets()),
      dbUser: newProjectDb.user,
      dbPassword: newProjectDb.password,
    }
    const project = await registry.register(
      { ref, name, orgSlug: ctx.org.slug, dbName: `proj_${ref}`, provision: true },
      secrets
    )
    return c.json(createdProjectBody(project, secrets, ctx), 201)
  })

  routes.get('/platform/projects/:ref/status', async (c) => {
    const project = await registry.get(c.req.param('ref'))
    if (!project) throw new ApiError(404, `Project "${c.req.param('ref')}" not found`)
    return c.json({ status: project.status })
  })

  routes.delete('/platform/projects/:ref', async (c) => {
    const ref = c.req.param('ref')
    const project = await registry.get(ref)
    if (!project || !(await registry.requestDelete(ref))) {
      throw new ApiError(404, `Project "${ref}" not found`)
    }
    return c.json({ id: project.id, name: project.name, ref })
  })

  return routes
}
