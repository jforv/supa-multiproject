import type { AdminRecord, AdminRepo, RefreshRecord, RefreshRepo } from './ports.js'

/** In-memory repos for unit tests; the Drizzle ones implement the same ports. */
export function createMemoryAdminRepo(seed: readonly AdminRecord[] = []): AdminRepo {
  const admins = new Map(seed.map((a) => [a.id, a]))
  return {
    findByEmail: async (email) =>
      [...admins.values()].find((a) => a.email === email.toLowerCase()) ?? null,
    findById: async (id) => admins.get(id) ?? null,
    count: async () => admins.size,
    insert: async (admin) => {
      admins.set(admin.id, admin)
    },
  }
}

export function createMemoryRefreshRepo(): RefreshRepo {
  const rows = new Map<string, RefreshRecord>()
  return {
    insert: async (rec) => {
      rows.set(rec.tokenHash, rec)
    },
    findByHash: async (hash) => rows.get(hash) ?? null,
    markUsed: async (hash, at) => {
      const row = rows.get(hash)
      if (!row || row.usedAt !== null) return false
      rows.set(hash, { ...row, usedAt: at })
      return true
    },
    revokeFamily: async (familyId, at) => {
      for (const [hash, row] of rows) {
        if (row.familyId === familyId) rows.set(hash, { ...row, revokedAt: at })
      }
    },
  }
}
