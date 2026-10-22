import { randomBytes } from 'node:crypto'
import { SignJWT } from 'jose'

const JWT_SECRET_BYTES = 48
const DB_PASSWORD_BYTES = 24
const KEY_LIFETIME_SECONDS = 10 * 365 * 24 * 60 * 60
const KEY_ISSUER = 'supabase'

export interface ProjectSecrets {
  readonly jwtSecret: string
  readonly dbPassword: string
  readonly anonKey: string
  readonly serviceKey: string
}

type ProjectRole = 'anon' | 'service_role'

const randomToken = (bytes: number): string => randomBytes(bytes).toString('base64url')

async function signRoleKey(role: ProjectRole, jwtSecret: string, now: Date): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1000)

  return new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(KEY_ISSUER)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + KEY_LIFETIME_SECONDS)
    .sign(new TextEncoder().encode(jwtSecret))
}

/** Fresh per-project secrets: JWT secret, DB password, and the anon/service_role API keys. */
export async function generateProjectSecrets(now: Date = new Date()): Promise<ProjectSecrets> {
  const jwtSecret = randomToken(JWT_SECRET_BYTES)
  const [anonKey, serviceKey] = await Promise.all([
    signRoleKey('anon', jwtSecret, now),
    signRoleKey('service_role', jwtSecret, now),
  ])

  return { jwtSecret, dbPassword: randomToken(DB_PASSWORD_BYTES), anonKey, serviceKey }
}
