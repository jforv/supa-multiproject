import { createHash, randomBytes } from 'node:crypto'
import { jwtVerify, SignJWT } from 'jose'

const REFRESH_BYTES = 32
const ROLE = 'authenticated'

export interface TokenServiceOptions {
  readonly jwtSecret: string
  readonly accessTtlSeconds: number
}

export interface AdminIdentity {
  readonly id: string
  readonly email: string
}

export interface AccessClaims {
  readonly sub: string
  readonly email: string
  readonly role: typeof ROLE
}

export interface TokenService {
  signAccess(admin: AdminIdentity, now?: Date): Promise<string>
  /** Returns null for any invalid, expired, or foreign token. */
  verifyAccess(token: string, now?: Date): Promise<AccessClaims | null>
  newRefreshToken(): string
  hashRefresh(token: string): string
}

export function createTokenService({
  jwtSecret,
  accessTtlSeconds,
}: TokenServiceOptions): TokenService {
  const key = new TextEncoder().encode(jwtSecret)

  return {
    signAccess(admin, now = new Date()) {
      const iat = Math.floor(now.getTime() / 1000)
      return new SignJWT({ email: admin.email, role: ROLE })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject(admin.id)
        .setIssuedAt(iat)
        .setExpirationTime(iat + accessTtlSeconds)
        .sign(key)
    },

    async verifyAccess(token, now = new Date()) {
      try {
        const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'], currentDate: now })
        const email = payload['email']
        if (typeof payload.sub !== 'string' || typeof email !== 'string') return null
        return { sub: payload.sub, email, role: ROLE }
      } catch {
        return null
      }
    },

    newRefreshToken: () => randomBytes(REFRESH_BYTES).toString('base64url'),
    hashRefresh: (token) => createHash('sha256').update(token).digest('hex'),
  }
}
