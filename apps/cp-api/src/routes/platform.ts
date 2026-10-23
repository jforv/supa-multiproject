import { Hono, type Context } from 'hono'

import type { AppDeps, AppEnv } from '../http/app.js'
import { ApiError } from '../http/errors.js'
import { requireAdmin } from '../http/requireAdmin.js'
import type { ProjectRecord } from '../registry/ports.js'
import type { ProjectRegistry, StoredSecrets } from '../registry/registry.js'
import { proxyPgMeta } from './pgMetaProxy.js'
import {
  databaseRow,
  encryptedConnection,
  orgBody,
  orgProjectRow,
  projectDetail,
  projectSettings,
  type ShapeContext,
} from './platformShapes.js'
import { findStub } from './stubs.js'

export interface PlatformDeps {
  readonly registry: ProjectRegistry
  readonly org: { readonly slug: string; readonly name: string }
  readonly projectDb: { readonly host: string; readonly port: number }
  readonly apiDomain: string
  readonly pgMeta: {
    readonly url: string
    readonly cryptoKey: string
    readonly fetch?: typeof fetch
  }
}

const DEFAULT_PAGE_LIMIT = 100

const pageParams = (c: Context) => ({
  limit: Number(c.req.query('limit')) || DEFAULT_PAGE_LIMIT,
  offset: Number(c.req.query('offset')) || 0,
})

export function platformRoutes(deps: AppDeps & { platform: PlatformDeps }) {
  const { registry, pgMeta } = deps.platform
  const ctx: ShapeContext = {
    org: deps.platform.org,
    projectDb: deps.platform.projectDb,
    apiDomain: deps.platform.apiDomain,
    metaCryptoKey: pgMeta.cryptoKey,
  }
  const routes = new Hono<AppEnv>()
  routes.use('/platform/*', requireAdmin(deps))
  routes.use('/v1/*', requireAdmin(deps))

  async function load(ref: string): Promise<{ project: ProjectRecord; secrets: StoredSecrets }> {
    const [project, secrets] = await Promise.all([registry.get(ref), registry.getSecrets(ref)])
    if (!project || !secrets) throw new ApiError(404, `Project "${ref}" not found`)
    return { project, secrets }
  }

  async function allDetails() {
    const projects = await registry.list()
    return Promise.all(
      projects.map(async (p) => {
        const { secrets } = await load(p.ref)
        return projectDetail(p, secrets, ctx)
      })
    )
  }

  routes.get('/platform/profile', async (c) => {
    const claims = c.get('admin')
    const email = (await deps.admins.findById(claims.sub))?.email ?? claims.email
    return c.json({
      id: 1,
      gotrue_id: claims.sub,
      primary_email: email,
      username: email.split('@')[0],
      first_name: '',
      last_name: '',
      organizations: [{ ...orgBody(ctx), projects: await allDetails() }],
    })
  })

  routes.get('/platform/profile/permissions', (c) =>
    c.json([
      {
        actions: ['%'],
        condition: true,
        organization_slug: ctx.org.slug,
        resources: ['%'],
        project_refs: [],
      },
    ])
  )

  routes.get('/platform/organizations', (c) => c.json([orgBody(ctx)]))

  routes.get('/platform/projects', async (c) => {
    const details = await allDetails()
    if (c.req.query('limit') === undefined) return c.json(details)
    const { limit, offset } = pageParams(c)
    return c.json({
      pagination: { count: details.length, limit, offset },
      projects: details.slice(offset, offset + limit),
    })
  })

  routes.get('/platform/organizations/:slug/projects', async (c) => {
    const all = await registry.list()
    const { limit, offset } = pageParams(c)
    return c.json({
      pagination: { count: all.length, limit, offset },
      projects: all.slice(offset, offset + limit).map(orgProjectRow),
    })
  })

  routes.get('/platform/projects/:ref', async (c) => {
    const { project, secrets } = await load(c.req.param('ref'))
    return c.json(projectDetail(project, secrets, ctx))
  })

  routes.get('/platform/projects/:ref/databases', async (c) => {
    const { project, secrets } = await load(c.req.param('ref'))
    return c.json([databaseRow(project, secrets, ctx)])
  })

  routes.get('/platform/projects/:ref/settings', async (c) => {
    const { project, secrets } = await load(c.req.param('ref'))
    return c.json(projectSettings(project, secrets, ctx))
  })

  routes.all('/platform/pg-meta/:ref/*', async (c) => {
    const ref = c.req.param('ref')
    const { project, secrets } = await load(ref)
    const prefix = `/platform/pg-meta/${ref}`
    return proxyPgMeta(c, c.req.path.slice(prefix.length), {
      url: pgMeta.url,
      connectionEncrypted: encryptedConnection(project, secrets, ctx),
      fetch: pgMeta.fetch ?? fetch,
    })
  })

  // Last: anything not matched above may be a harmless stub; otherwise fall through to 404.
  routes.all('*', async (c, next) => {
    const stub = findStub(c.req.method, c.req.path)
    if (!stub) return next()
    return c.json(stub.respond ? await stub.respond(c) : stub.body)
  })

  return routes
}
