import { generateProjectSecrets } from '../crypto/projectKeys.js'
import type { ProjectRecord } from './ports.js'
import type { ProjectRegistry } from './registry.js'

export interface AdoptInput {
  readonly ref: string
  readonly name: string
  readonly orgSlug: string
  readonly dbName: string
  readonly dbUser: string
  readonly dbPassword: string
}

/**
 * Registers a database that already exists as an ACTIVE_HEALTHY project. API keys and the JWT
 * secret are minted fresh; the database credentials are the ones the caller supplies.
 */
export async function adoptProject(
  registry: ProjectRegistry,
  { dbUser, dbPassword, ...project }: AdoptInput
): Promise<ProjectRecord> {
  const generated = await generateProjectSecrets()
  return registry.register(
    { ...project, status: 'ACTIVE_HEALTHY' },
    { ...generated, dbUser, dbPassword }
  )
}
