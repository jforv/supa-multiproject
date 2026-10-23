import { buildConnectionString, encryptConnectionString } from '../crypto/pgMetaCipher.js'
import type { ProjectRecord } from '../registry/ports.js'
import type { StoredSecrets } from '../registry/registry.js'

export interface ShapeContext {
  readonly org: { readonly slug: string; readonly name: string }
  readonly projectDb: { readonly host: string; readonly port: number }
  readonly apiDomain: string
  readonly metaCryptoKey: string
}

const REGION = 'local'
const PRIMARY_DB_VERSION = '17'

export const projectConnection = (
  p: ProjectRecord,
  secrets: StoredSecrets,
  ctx: ShapeContext
): string =>
  buildConnectionString({
    user: secrets.dbUser,
    password: secrets.dbPassword,
    host: ctx.projectDb.host,
    port: ctx.projectDb.port,
    database: p.dbName,
  })

export const encryptedConnection = (p: ProjectRecord, secrets: StoredSecrets, ctx: ShapeContext) =>
  encryptConnectionString(projectConnection(p, secrets, ctx), ctx.metaCryptoKey)

const insertedAt = (p: ProjectRecord) => p.createdAt.toISOString()
const restUrl = (p: ProjectRecord, ctx: ShapeContext) => `http://${p.ref}.${ctx.apiDomain}/rest/v1/`

export const orgBody = (ctx: ShapeContext) => ({
  id: 1,
  name: ctx.org.name,
  slug: ctx.org.slug,
  billing_email: null,
  plan: { id: 'enterprise', name: 'Enterprise' },
})

export const projectDetail = (p: ProjectRecord, secrets: StoredSecrets, ctx: ShapeContext) => ({
  id: p.id,
  ref: p.ref,
  name: p.name,
  organization_id: 1,
  organization_slug: p.orgSlug,
  cloud_provider: 'localhost',
  status: p.status,
  region: REGION,
  inserted_at: insertedAt(p),
  connectionString: encryptedConnection(p, secrets, ctx),
  restUrl: restUrl(p, ctx),
  dbVersion: PRIMARY_DB_VERSION,
  is_branch_enabled: false,
  preview_branch_refs: [],
  infra_compute_size: 'micro',
})

/** The 201 body for project creation: the API keys are shown here, as on the hosted platform. */
export const createdProjectBody = (
  p: ProjectRecord,
  secrets: StoredSecrets,
  ctx: ShapeContext
) => ({
  anon_key: secrets.anonKey,
  service_key: secrets.serviceKey,
  cloud_provider: 'localhost',
  endpoint: `${p.ref}.${ctx.apiDomain}`,
  id: p.id,
  infra_compute_size: 'micro',
  inserted_at: insertedAt(p),
  is_branch_enabled: false,
  is_physical_backups_enabled: false,
  name: p.name,
  organization_id: 1,
  organization_slug: p.orgSlug,
  preview_branch_refs: [],
  ref: p.ref,
  region: REGION,
  status: p.status,
  subscription_id: null,
})

export const orgProjectRow = (p: ProjectRecord) => ({
  cloud_provider: 'localhost',
  databases: [
    {
      cloud_provider: 'AWS',
      identifier: p.ref,
      region: REGION,
      status: p.status,
      type: 'PRIMARY',
    },
  ],
  inserted_at: insertedAt(p),
  integration_source: null,
  is_branch: false,
  name: p.name,
  ref: p.ref,
  region: REGION,
  status: p.status,
})

export const databaseRow = (p: ProjectRecord, secrets: StoredSecrets, ctx: ShapeContext) => ({
  cloud_provider: 'AWS',
  connection_string_read_only: null,
  connectionString: encryptedConnection(p, secrets, ctx),
  db_host: ctx.projectDb.host,
  db_name: p.dbName,
  db_port: ctx.projectDb.port,
  db_user: secrets.dbUser,
  identifier: p.ref,
  inserted_at: insertedAt(p),
  region: REGION,
  restUrl: restUrl(p, ctx),
  size: null,
  status: p.status,
})

export const projectSettings = (p: ProjectRecord, secrets: StoredSecrets, ctx: ShapeContext) => ({
  app_config: {
    db_schema: 'public',
    endpoint: `${p.ref}.${ctx.apiDomain}`,
    storage_endpoint: `${p.ref}.${ctx.apiDomain}`,
    protocol: 'http',
  },
  cloud_provider: 'AWS',
  db_dns_name: ctx.projectDb.host,
  db_host: ctx.projectDb.host,
  db_ip_addr_config: 'legacy',
  db_name: p.dbName,
  db_port: ctx.projectDb.port,
  db_user: secrets.dbUser,
  inserted_at: insertedAt(p),
  jwt_secret: secrets.jwtSecret,
  id: p.id,
  name: p.name,
  ref: p.ref,
  region: REGION,
  service_api_keys: [
    { api_key: secrets.anonKey, name: 'anon key', tags: 'anon' },
    { api_key: secrets.serviceKey, name: 'service_role key', tags: 'service_role' },
  ],
  ssl_enforced: false,
  status: p.status,
  services: [],
})
