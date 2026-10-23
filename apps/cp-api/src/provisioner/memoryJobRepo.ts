import type { Job, JobKind, JobRepo } from './ports.js'

export interface MemoryJob extends Job {
  readonly status: 'pending' | 'running' | 'done' | 'failed'
  readonly lastError: string | null
  readonly runAfter: Date
  readonly lockedUntil: Date | null
}

export type MemoryJobRepo = JobRepo & {
  enqueue(projectRef: string, kind: JobKind): void
  all(): readonly MemoryJob[]
}

/** In-memory queue for unit tests; the Drizzle one implements the same port. */
export function createMemoryJobRepo(): MemoryJobRepo {
  let jobs: MemoryJob[] = []
  let seq = 0

  const update = (id: string, change: Partial<MemoryJob>) => {
    jobs = jobs.map((j) => (j.id === id ? { ...j, ...change } : j))
  }

  return {
    enqueue(projectRef, kind) {
      jobs = [
        ...jobs,
        {
          id: `job-${++seq}`,
          projectRef,
          kind,
          attempts: 0,
          status: 'pending',
          lastError: null,
          runAfter: new Date(0),
          lockedUntil: null,
        },
      ]
    },

    all: () => jobs,

    async claim(now, leaseMs) {
      const found = jobs.find(
        (j) =>
          (j.status === 'pending' && j.runAfter <= now) ||
          (j.status === 'running' && j.lockedUntil !== null && j.lockedUntil <= now)
      )
      if (!found) return null
      const attempts = found.attempts + 1
      update(found.id, {
        status: 'running',
        attempts,
        lockedUntil: new Date(now.getTime() + leaseMs),
      })
      return { id: found.id, projectRef: found.projectRef, kind: found.kind, attempts }
    },

    complete: async (id) => update(id, { status: 'done', lockedUntil: null }),

    retry: async (id, error, runAfter) =>
      update(id, { status: 'pending', lastError: error, runAfter, lockedUntil: null }),

    fail: async (id, error) =>
      update(id, { status: 'failed', lastError: error, lockedUntil: null }),
  }
}
