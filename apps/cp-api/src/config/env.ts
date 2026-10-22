import { z } from 'zod'

const MASTER_KEY_BYTES = 32
const MIN_JWT_SECRET_LENGTH = 32
const MIN_ADMIN_PASSWORD_LENGTH = 12
const DEFAULT_PORT = 8100
const MAX_PORT = 65535

export class EnvError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EnvError'
  }
}

export interface BootstrapAdmin {
  readonly email: string
  readonly password: string
}

export interface Env {
  readonly port: number
  readonly databaseUrl: string
  readonly masterKey: Buffer
  readonly masterKeyId: string
  readonly jwtSecret: string
  readonly allowedOrigins: readonly string[]
  readonly pgMetaUrl: string
  readonly pgMetaCryptoKey: string
  readonly orgSlug: string
  readonly orgName: string
  readonly bootstrapAdmin?: BootstrapAdmin
}

const splitList = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)

const schema = z
  .object({
    CP_PORT: z.coerce.number().int().min(1).max(MAX_PORT).default(DEFAULT_PORT),
    CP_DATABASE_URL: z.string().url(),
    CP_MASTER_KEY: z
      .string()
      .refine(
        (value) => Buffer.from(value, 'base64').length === MASTER_KEY_BYTES,
        `must be ${MASTER_KEY_BYTES} bytes, base64-encoded`
      ),
    CP_MASTER_KEY_ID: z.string().min(1).default('k1'),
    CP_JWT_SECRET: z.string().min(MIN_JWT_SECRET_LENGTH),
    CP_ALLOWED_ORIGINS: z
      .string()
      .transform(splitList)
      .refine((origins) => origins.length > 0, 'must list at least one origin'),
    CP_PG_META_URL: z.string().url(),
    CP_PG_META_CRYPTO_KEY: z.string().min(1),
    CP_ORG_SLUG: z.string().min(1).default('default-org'),
    CP_ORG_NAME: z.string().min(1).default('Default Org'),
    CP_BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
    CP_BOOTSTRAP_ADMIN_PASSWORD: z.string().min(MIN_ADMIN_PASSWORD_LENGTH).optional(),
  })
  .refine(
    (value) =>
      (value.CP_BOOTSTRAP_ADMIN_EMAIL === undefined) ===
      (value.CP_BOOTSTRAP_ADMIN_PASSWORD === undefined),
    {
      message: 'CP_BOOTSTRAP_ADMIN_EMAIL and CP_BOOTSTRAP_ADMIN_PASSWORD must be set together',
      path: ['CP_BOOTSTRAP_ADMIN'],
    }
  )

const withoutBlanks = (source: Readonly<Record<string, string | undefined>>) =>
  Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== '')
  )

/**
 * Parses and validates the process environment once at startup.
 * Error messages name the offending variables but never echo their values.
 */
export function loadEnv(source: Readonly<Record<string, string | undefined>>): Env {
  const parsed = schema.safeParse(withoutBlanks(source))

  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`
    )
    throw new EnvError(`Invalid environment configuration:\n- ${problems.join('\n- ')}`)
  }

  const raw = parsed.data
  const bootstrapAdmin =
    raw.CP_BOOTSTRAP_ADMIN_EMAIL !== undefined && raw.CP_BOOTSTRAP_ADMIN_PASSWORD !== undefined
      ? { email: raw.CP_BOOTSTRAP_ADMIN_EMAIL, password: raw.CP_BOOTSTRAP_ADMIN_PASSWORD }
      : undefined

  return {
    port: raw.CP_PORT,
    databaseUrl: raw.CP_DATABASE_URL,
    masterKey: Buffer.from(raw.CP_MASTER_KEY, 'base64'),
    masterKeyId: raw.CP_MASTER_KEY_ID,
    jwtSecret: raw.CP_JWT_SECRET,
    allowedOrigins: raw.CP_ALLOWED_ORIGINS,
    pgMetaUrl: raw.CP_PG_META_URL,
    pgMetaCryptoKey: raw.CP_PG_META_CRYPTO_KEY,
    orgSlug: raw.CP_ORG_SLUG,
    orgName: raw.CP_ORG_NAME,
    ...(bootstrapAdmin ? { bootstrapAdmin } : {}),
  }
}
