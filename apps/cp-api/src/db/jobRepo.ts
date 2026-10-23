import { eq, sql } from 'drizzle-orm'

import type { Job, JobKind, JobRepo } from '../provisioner/ports.js'
import type { Db } from './client.js'
import { jobs } from './schema.js'

type ClaimedRow = {
  id: string
  project_ref: string
  kind: JobKind
  attempts: number
}

export function createJobRepo(db: Db): JobRepo {
  return {
    async claim(now, leaseMs): Promise<Job | null> {
      const lockedUntil = new Date(now.getTime() + leaseMs)
      // One statement: pick the oldest runnable job, skipping rows other workers hold locked.
      const result = await db.execute<ClaimedRow>(sql`
        UPDATE jobs
           SET status = 'running', attempts = attempts + 1,
               locked_until = ${lockedUntil.toISOString()}::timestamptz,
               updated_at = ${now.toISOString()}::timestamptz
         WHERE id = (
           SELECT id FROM jobs
            WHERE (status = 'pending' AND run_after <= ${now.toISOString()}::timestamptz)
               OR (status = 'running' AND locked_until <= ${now.toISOString()}::timestamptz)
            ORDER BY created_at
            FOR UPDATE SKIP LOCKED
            LIMIT 1)
        RETURNING id, project_ref, kind, attempts`)
      const row = result.rows[0]
      return row
        ? { id: row.id, projectRef: row.project_ref, kind: row.kind, attempts: row.attempts }
        : null
    },

    async complete(id, now) {
      await db
        .update(jobs)
        .set({ status: 'done', lockedUntil: null, updatedAt: now })
        .where(eq(jobs.id, id))
    },

    async retry(id, error, runAfter, now) {
      await db
        .update(jobs)
        .set({ status: 'pending', lastError: error, runAfter, lockedUntil: null, updatedAt: now })
        .where(eq(jobs.id, id))
    },

    async fail(id, error, now) {
      await db
        .update(jobs)
        .set({ status: 'failed', lastError: error, lockedUntil: null, updatedAt: now })
        .where(eq(jobs.id, id))
    },
  }
}
