export interface AdminRecord {
  readonly id: string
  readonly email: string
  readonly passwordHash: string
  readonly disabled: boolean
}

export interface AdminRepo {
  findByEmail(email: string): Promise<AdminRecord | null>
  findById(id: string): Promise<AdminRecord | null>
  count(): Promise<number>
  insert(admin: AdminRecord): Promise<void>
}

export interface RefreshRecord {
  readonly tokenHash: string
  readonly adminId: string
  readonly familyId: string
  readonly expiresAt: Date
  readonly usedAt: Date | null
  readonly revokedAt: Date | null
}

export interface RefreshRepo {
  insert(rec: RefreshRecord): Promise<void>
  findByHash(tokenHash: string): Promise<RefreshRecord | null>
  /** Atomic: true only for the one caller that flips an unused token to used. */
  markUsed(tokenHash: string, at: Date): Promise<boolean>
  revokeFamily(familyId: string, at: Date): Promise<void>
}
