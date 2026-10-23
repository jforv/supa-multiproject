export type ContentType = 'sql' | 'report' | 'log_sql' | 'notebook'
export type Visibility = 'user' | 'project' | 'org' | 'public'

export interface ContentRow {
  readonly id: string
  readonly projectRef: string
  /** Admin uuid. */
  readonly ownerId: string
  readonly updatedBy: string | null
  readonly type: ContentType
  readonly visibility: Visibility
  readonly name: string
  readonly description: string | null
  readonly favorite: boolean
  readonly folderId: string | null
  readonly body: Record<string, unknown> | null
  readonly insertedAt: Date
  readonly updatedAt: Date
}

/** Fields a save may change; `undefined` leaves the stored value alone, `null` clears it. */
export interface ContentPatch {
  readonly name?: string
  readonly description?: string | null
  readonly favorite?: boolean
  readonly folderId?: string | null
  readonly visibility?: Visibility
  readonly body?: Record<string, unknown> | null
}

export interface NewContent extends ContentPatch {
  readonly id: string
  readonly type: ContentType
  readonly name: string
}

export interface FolderRow {
  readonly id: string
  readonly projectRef: string
  readonly ownerId: string
  readonly name: string
  readonly parentId: string | null
}

export interface ContentQuery {
  readonly type?: ContentType
  readonly name?: string
  readonly favorite?: boolean
  readonly visibility?: Visibility
  /** `null` = root only, a uuid = that folder only, omitted = anywhere. */
  readonly folderId?: string | null
  readonly sortBy: 'name' | 'inserted_at'
  readonly sortOrder: 'asc' | 'desc'
  readonly limit: number
  readonly offset: number
}

export interface ContentCounts {
  readonly favorites: number
  readonly private: number
  readonly shared: number
}

/**
 * Every call takes the viewing admin: `user`-visibility rows and all folders are private
 * to their owner, the other visibilities are shared by every admin.
 */
export interface ContentRepo {
  list(projectRef: string, viewer: string, query: ContentQuery): Promise<ContentRow[]>
  get(projectRef: string, viewer: string, id: string): Promise<ContentRow | null>
  insert(projectRef: string, owner: string, input: NewContent): Promise<ContentRow>
  /** Null when the row does not exist or is not visible to `viewer`. */
  update(
    projectRef: string,
    viewer: string,
    id: string,
    patch: ContentPatch
  ): Promise<ContentRow | null>
  /** Returns the ids that were actually deleted. */
  remove(projectRef: string, viewer: string, ids: readonly string[]): Promise<string[]>
  count(
    projectRef: string,
    viewer: string,
    filter: { type?: ContentType; name?: string }
  ): Promise<ContentCounts>

  listFolders(
    projectRef: string,
    viewer: string,
    filter: { parentId: string | null; name?: string }
  ): Promise<FolderRow[]>
  getFolder(projectRef: string, viewer: string, id: string): Promise<FolderRow | null>
  insertFolder(
    projectRef: string,
    owner: string,
    input: { name: string; parentId: string | null }
  ): Promise<FolderRow>
  renameFolder(
    projectRef: string,
    viewer: string,
    id: string,
    name: string
  ): Promise<FolderRow | null>
  /** Deleting a folder deletes what it contains. Returns the folder ids actually deleted. */
  removeFolders(projectRef: string, viewer: string, ids: readonly string[]): Promise<string[]>
}
