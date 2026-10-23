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
  /** Inserts project and encrypted secrets together; throws on a duplicate ref. */
  insert(project: NewProject, secretsEnc: string): Promise<ProjectRecord>
  getSecretsEnc(ref: string): Promise<string | null>
}
