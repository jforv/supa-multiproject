import { asc, eq } from 'drizzle-orm'

import type { ProjectRepo } from '../registry/ports.js'
import type { Db } from './client.js'
import { projects, projectSecrets } from './schema.js'

const PG_UNIQUE_VIOLATION = '23505'

const isUniqueViolation = (err: unknown): boolean =>
  typeof err === 'object' &&
  err !== null &&
  ((err as { code?: unknown }).code === PG_UNIQUE_VIOLATION ||
    isUniqueViolation((err as { cause?: unknown }).cause))

export function createProjectRepo(db: Db): ProjectRepo {
  return {
    list: () => db.select().from(projects).orderBy(asc(projects.id)),

    async findByRef(ref) {
      const [row] = await db.select().from(projects).where(eq(projects.ref, ref))
      return row ?? null
    },

    async insert(project, secretsEnc) {
      try {
        return await db.transaction(async (tx) => {
          const [row] = await tx.insert(projects).values(project).returning()
          if (!row) throw new Error('Insert returned no row')
          await tx.insert(projectSecrets).values({ projectRef: project.ref, secretsEnc })
          return row
        })
      } catch (err) {
        if (isUniqueViolation(err)) throw new Error(`Project "${project.ref}" already exists`)
        throw err
      }
    },

    async getSecretsEnc(ref) {
      const [row] = await db
        .select({ enc: projectSecrets.secretsEnc })
        .from(projectSecrets)
        .where(eq(projectSecrets.projectRef, ref))
      return row?.enc ?? null
    },
  }
}
