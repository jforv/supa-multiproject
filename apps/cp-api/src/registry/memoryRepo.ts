import type { JobKind } from '../provisioner/ports.js'
import type { ProjectRecord, ProjectRepo } from './ports.js'

export interface JobEnqueuer {
  enqueue(projectRef: string, kind: JobKind): void
}

/** In-memory project repo for unit tests; the Drizzle one implements the same port. */
export function createMemoryProjectRepo(jobs?: JobEnqueuer): ProjectRepo {
  let rows: ProjectRecord[] = []
  const secrets = new Map<string, string>()
  let nextId = 1

  const replace = (ref: string, change: Partial<ProjectRecord>) => {
    rows = rows.map((p) => (p.ref === ref ? { ...p, ...change } : p))
  }

  return {
    list: async () => [...rows],
    findByRef: async (ref) => rows.find((p) => p.ref === ref) ?? null,

    insert: async (project, secretsEnc, jobKind) => {
      if (rows.some((p) => p.ref === project.ref || p.dbName === project.dbName)) {
        throw new Error(`Project "${project.ref}" already exists`)
      }
      const record = { ...project, id: nextId++ }
      rows = [...rows, record]
      secrets.set(project.ref, secretsEnc)
      if (jobKind) jobs?.enqueue(project.ref, jobKind)
      return record
    },

    getSecretsEnc: async (ref) => secrets.get(ref) ?? null,

    setStatus: async (ref, status, now) => replace(ref, { status, updatedAt: now }),

    remove: async (ref) => {
      rows = rows.filter((p) => p.ref !== ref)
      secrets.delete(ref)
    },

    requestDelete: async (ref, now) => {
      const project = rows.find((p) => p.ref === ref)
      if (!project) return false
      if (project.status !== 'GOING_DOWN') {
        replace(ref, { status: 'GOING_DOWN', updatedAt: now })
        jobs?.enqueue(ref, 'delete')
      }
      return true
    },
  }
}
