import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'

// Mirrors migrations/*.sql; the SQL files are the source of truth for the control DB.
export const admins = pgTable('admins', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  disabled: boolean('disabled').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const refreshTokens = pgTable('refresh_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  adminId: uuid('admin_id')
    .notNull()
    .references(() => admins.id, { onDelete: 'cascade' }),
  familyId: uuid('family_id').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const projects = pgTable('projects', {
  id: integer('id').notNull().unique().generatedAlwaysAsIdentity(),
  ref: text('ref').primaryKey(),
  name: text('name').notNull(),
  orgSlug: text('org_slug').notNull(),
  status: text('status').notNull().default('COMING_UP'),
  desiredState: text('desired_state').notNull().default('active'),
  dbName: text('db_name').notNull().unique(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectRef: text('project_ref').notNull(),
  kind: text('kind').notNull(),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const projectSecrets = pgTable('project_secrets', {
  projectRef: text('project_ref')
    .primaryKey()
    .references(() => projects.ref, { onDelete: 'cascade' }),
  secretsEnc: text('secrets_enc').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const contentFolders = pgTable('content_folders', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectRef: text('project_ref')
    .notNull()
    .references(() => projects.ref, { onDelete: 'cascade' }),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => admins.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  parentId: uuid('parent_id').references((): AnyPgColumn => contentFolders.id, {
    onDelete: 'cascade',
  }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const content = pgTable(
  'content',
  {
    projectRef: text('project_ref')
      .notNull()
      .references(() => projects.ref, { onDelete: 'cascade' }),
    id: uuid('id').notNull(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => admins.id, { onDelete: 'cascade' }),
    updatedBy: uuid('updated_by').references(() => admins.id, { onDelete: 'set null' }),
    type: text('type').notNull(),
    visibility: text('visibility').notNull().default('user'),
    name: text('name').notNull(),
    description: text('description'),
    favorite: boolean('favorite').notNull().default(false),
    folderId: uuid('folder_id').references(() => contentFolders.id, { onDelete: 'cascade' }),
    body: jsonb('body').$type<Record<string, unknown>>(),
    insertedAt: timestamp('inserted_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectRef, t.id] })]
)
