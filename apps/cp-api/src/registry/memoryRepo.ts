import type { ProjectRecord, ProjectRepo } from './ports.js'

/** In-memory project repo for unit tests; the Drizzle one implements the same port. */
export function createMemoryProjectRepo(): ProjectRepo {
  const rows: ProjectRecord[] = []
  const secrets = new Map<string, string>()
  return {
    list: async () => [...rows],
    findByRef: async (ref) => rows.find((p) => p.ref === ref) ?? null,
    insert: async (project, secretsEnc) => {
      if (rows.some((p) => p.ref === project.ref || p.dbName === project.dbName)) {
        throw new Error(`Project "${project.ref}" already exists`)
      }
      const record = { ...project, id: rows.length + 1 }
      rows.push(record)
      secrets.set(project.ref, secretsEnc)
      return record
    },
    getSecretsEnc: async (ref) => secrets.get(ref) ?? null,
  }
}
