import { and, count, eq, isNull } from 'drizzle-orm'

import type { AdminRepo, RefreshRepo } from '../auth/ports.js'
import type { Db } from './client.js'
import { admins, refreshTokens } from './schema.js'

export function createAdminRepo(db: Db): AdminRepo {
  const pick = {
    id: admins.id,
    email: admins.email,
    passwordHash: admins.passwordHash,
    disabled: admins.disabled,
  }
  return {
    async findByEmail(email) {
      const [row] = await db.select(pick).from(admins).where(eq(admins.email, email.toLowerCase()))
      return row ?? null
    },
    async findById(id) {
      const [row] = await db.select(pick).from(admins).where(eq(admins.id, id))
      return row ?? null
    },
    async count() {
      const [row] = await db.select({ n: count() }).from(admins)
      return row?.n ?? 0
    },
    async insert(admin) {
      await db.insert(admins).values({ ...admin, email: admin.email.toLowerCase() })
    },
  }
}

export function createRefreshRepo(db: Db): RefreshRepo {
  return {
    async insert(rec) {
      await db.insert(refreshTokens).values(rec)
    },
    async findByHash(tokenHash) {
      const [row] = await db
        .select({
          tokenHash: refreshTokens.tokenHash,
          adminId: refreshTokens.adminId,
          familyId: refreshTokens.familyId,
          expiresAt: refreshTokens.expiresAt,
          usedAt: refreshTokens.usedAt,
          revokedAt: refreshTokens.revokedAt,
        })
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, tokenHash))
      return row ?? null
    },
    async markUsed(tokenHash, at) {
      const rows = await db
        .update(refreshTokens)
        .set({ usedAt: at })
        .where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.usedAt)))
        .returning({ h: refreshTokens.tokenHash })
      return rows.length > 0
    },
    async revokeFamily(familyId, at) {
      await db
        .update(refreshTokens)
        .set({ revokedAt: at })
        .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)))
    },
  }
}
