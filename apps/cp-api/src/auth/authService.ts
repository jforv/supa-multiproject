import { randomUUID } from 'node:crypto'

import { hashPassword, verifyPassword } from './passwords.js'
import type { AdminRepo, RefreshRepo } from './ports.js'
import type { AdminIdentity, TokenService } from './tokens.js'

const MAX_FAILURES = 5
const FAILURE_WINDOW_MS = 15 * 60_000
const DEFAULT_ACCESS_TTL = 3600

export type AuthErrorCode = 'invalid_credentials' | 'invalid_token' | 'rate_limited'

export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode) {
    super(code)
    this.name = 'AuthError'
  }
}

export interface Session {
  readonly accessToken: string
  readonly refreshToken: string
  readonly expiresIn: number
  readonly admin: AdminIdentity
}

export interface AuthServiceDeps {
  readonly admins: AdminRepo
  readonly refresh: RefreshRepo
  readonly tokens: TokenService
  readonly accessTtlSeconds?: number
  readonly refreshTtlSeconds: number
}

export function createAuthService(deps: AuthServiceDeps) {
  const { admins, refresh, tokens, refreshTtlSeconds } = deps
  const accessTtl = deps.accessTtlSeconds ?? DEFAULT_ACCESS_TTL
  // ponytail: in-memory limiter is per-process; move to the DB if cp-api ever runs replicated.
  const failures = new Map<string, { count: number; since: number }>()
  let dummyHash: Promise<string> | undefined

  const isLocked = (key: string, now: Date): boolean => {
    const entry = failures.get(key)
    if (!entry) return false
    if (now.getTime() - entry.since >= FAILURE_WINDOW_MS) {
      failures.delete(key)
      return false
    }
    return entry.count >= MAX_FAILURES
  }

  const recordFailure = (key: string, now: Date): void => {
    const entry = failures.get(key)
    failures.set(key, { count: (entry?.count ?? 0) + 1, since: entry?.since ?? now.getTime() })
  }

  async function issue(admin: AdminIdentity, familyId: string, now: Date): Promise<Session> {
    const refreshToken = tokens.newRefreshToken()
    await refresh.insert({
      tokenHash: tokens.hashRefresh(refreshToken),
      adminId: admin.id,
      familyId,
      expiresAt: new Date(now.getTime() + refreshTtlSeconds * 1000),
      usedAt: null,
      revokedAt: null,
    })
    return {
      accessToken: await tokens.signAccess(admin, now),
      refreshToken,
      expiresIn: accessTtl,
      admin,
    }
  }

  return {
    async login(email: string, password: string, ip: string, now = new Date()): Promise<Session> {
      const normalized = email.trim().toLowerCase()
      const key = `${normalized}|${ip}`
      if (isLocked(key, now)) throw new AuthError('rate_limited')

      const admin = await admins.findByEmail(normalized)
      // Always run one argon2 verify so unknown emails cost the same as wrong passwords.
      dummyHash ??= hashPassword('timing-equalizer')
      const ok = await verifyPassword(admin?.passwordHash ?? (await dummyHash), password)

      if (!admin || admin.disabled || !ok) {
        recordFailure(key, now)
        throw new AuthError('invalid_credentials')
      }
      failures.delete(key)
      return issue({ id: admin.id, email: admin.email }, randomUUID(), now)
    },

    async refresh(token: string, now = new Date()): Promise<Session> {
      const rec = await refresh.findByHash(tokens.hashRefresh(token))
      if (!rec || rec.revokedAt || rec.expiresAt <= now) throw new AuthError('invalid_token')

      if (rec.usedAt || !(await refresh.markUsed(rec.tokenHash, now))) {
        await refresh.revokeFamily(rec.familyId, now) // replay of a rotated token: kill the session
        throw new AuthError('invalid_token')
      }
      const admin = await admins.findById(rec.adminId)
      if (!admin || admin.disabled) throw new AuthError('invalid_token')
      return issue({ id: admin.id, email: admin.email }, rec.familyId, now)
    },

    async logout(token: string, now = new Date()): Promise<void> {
      const rec = await refresh.findByHash(tokens.hashRefresh(token))
      if (rec) await refresh.revokeFamily(rec.familyId, now)
    },
  }
}

export type AuthService = ReturnType<typeof createAuthService>
