import { boolean, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

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

export const projectSecrets = pgTable('project_secrets', {
  projectRef: text('project_ref')
    .primaryKey()
    .references(() => projects.ref, { onDelete: 'cascade' }),
  secretsEnc: text('secrets_enc').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
