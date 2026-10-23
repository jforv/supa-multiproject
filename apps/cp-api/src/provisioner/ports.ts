export type JobKind = 'create' | 'delete'

export interface Job {
  readonly id: string
  readonly projectRef: string
  readonly kind: JobKind
  readonly attempts: number
}

export interface JobRepo {
  /**
   * Claims the next runnable job (pending, or running with an expired lease) and leases it.
   * `attempts` on the returned job already counts this claim.
   */
  claim(now: Date, leaseMs: number): Promise<Job | null>
  complete(id: string, now: Date): Promise<void>
  /** Puts the job back to pending, runnable at `runAfter`. */
  retry(id: string, error: string, runAfter: Date, now: Date): Promise<void>
  /** Gives up on the job. */
  fail(id: string, error: string, now: Date): Promise<void>
}

/** Cluster-level operations the provisioner needs; each must be safe to repeat. */
export interface ProjectDbAdmin {
  createDatabase(dbName: string): Promise<void>
  dropDatabase(dbName: string): Promise<void>
}
