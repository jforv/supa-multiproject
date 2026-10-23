export interface ProjectRecord {
  readonly id: number
  readonly ref: string
  readonly name: string
  readonly orgSlug: string
  readonly status: string
  readonly desiredState: string
  readonly dbName: string
  readonly version: number
  readonly createdAt: Date
  readonly updatedAt: Date
}

export type NewProject = Omit<ProjectRecord, 'id'>

export interface ProjectRepo {
  /** Creation order. */
  list(): Promise<ProjectRecord[]>
  findByRef(ref: string): Promise<ProjectRecord | null>
  /**
   * Inserts project and encrypted secrets together; throws on a duplicate ref.
   * With `jobKind` the matching provisioner job is queued in the same transaction.
   */
  insert(project: NewProject, secretsEnc: string, jobKind?: 'create'): Promise<ProjectRecord>
  getSecretsEnc(ref: string): Promise<string | null>
  setStatus(ref: string, status: string, now: Date): Promise<void>
  /** Deletes the project and (by cascade) its secrets. */
  remove(ref: string): Promise<void>
  /**
   * Marks the project GOING_DOWN and queues a delete job, once. Returns false for an unknown ref.
   */
  requestDelete(ref: string, now: Date): Promise<boolean>
}
