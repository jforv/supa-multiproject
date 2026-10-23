import { asc, eq, sql } from 'drizzle-orm'

import type { ProjectRepo } from '../registry/ports.js'
import type { Db } from './client.js'
import { jobs, projects, projectSecrets } from './schema.js'

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

    async insert(project, secretsEnc, jobKind) {
      try {
        return await db.transaction(async (tx) => {
          const [row] = await tx.insert(projects).values(project).returning()
          if (!row) throw new Error('Insert returned no row')
          await tx.insert(projectSecrets).values({ projectRef: project.ref, secretsEnc })
          // Same transaction as the project: a crash can't leave a project nobody will build.
          if (jobKind) await tx.insert(jobs).values({ projectRef: project.ref, kind: jobKind })
          return row
        })
      } catch (err) {
        if (isUniqueViolation(err)) throw new Error(`Project "${project.ref}" already exists`)
        throw err
      }
    },

    async setStatus(ref, status, now) {
      await db.update(projects).set({ status, updatedAt: now }).where(eq(projects.ref, ref))
    },

    async remove(ref) {
      await db.delete(projects).where(eq(projects.ref, ref))
    },

    requestDelete: (ref, now) =>
      db.transaction(async (tx) => {
        const [row] = await tx
          .update(projects)
          .set({ status: 'GOING_DOWN', updatedAt: now })
          .where(eq(projects.ref, ref))
          .returning({ ref: projects.ref })
        if (!row) return false
        // At most one live delete job per project; a previously failed one gets a fresh job.
        await tx.execute(sql`
          INSERT INTO jobs (project_ref, kind)
          SELECT ${ref}, 'delete'
           WHERE NOT EXISTS (
             SELECT 1 FROM jobs
              WHERE project_ref = ${ref} AND kind = 'delete' AND status IN ('pending', 'running'))`)
        return true
      }),

    async getSecretsEnc(ref) {
      const [row] = await db
        .select({ enc: projectSecrets.secretsEnc })
        .from(projectSecrets)
        .where(eq(projectSecrets.projectRef, ref))
      return row?.enc ?? null
    },
  }
}
