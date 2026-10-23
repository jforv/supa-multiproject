import { z } from 'zod'

import type { SecretBox } from '../crypto/secretBox.js'
import type { ProjectRecord, ProjectRepo } from './ports.js'

const REF_PATTERN = /^[a-z0-9]{3,40}$/

export interface StoredSecrets {
  readonly jwtSecret: string
  readonly dbPassword: string
  readonly anonKey: string
  readonly serviceKey: string
  readonly dbUser: string
}

const secretsSchema = z.object({
  jwtSecret: z.string(),
  dbPassword: z.string(),
  anonKey: z.string(),
  serviceKey: z.string(),
  dbUser: z.string(),
})

export interface RegisterInput {
  readonly ref: string
  readonly name: string
  readonly orgSlug: string
  readonly dbName: string
  /** Defaults to COMING_UP; seeded projects that already exist pass ACTIVE_HEALTHY. */
  readonly status?: string
}

export interface ProjectRegistryDeps {
  readonly repo: ProjectRepo
  readonly secretBox: SecretBox
}

export function createProjectRegistry({ repo, secretBox }: ProjectRegistryDeps) {
  return {
    async register(
      input: RegisterInput,
      secrets: StoredSecrets,
      now: Date = new Date()
    ): Promise<ProjectRecord> {
      if (!REF_PATTERN.test(input.ref)) {
        throw new Error(`Invalid project ref "${input.ref}": use 3-40 lowercase letters or digits`)
      }
      return repo.insert(
        {
          ref: input.ref,
          name: input.name,
          orgSlug: input.orgSlug,
          dbName: input.dbName,
          status: input.status ?? 'COMING_UP',
          desiredState: 'active',
          version: 1,
          createdAt: now,
          updatedAt: now,
        },
        secretBox.encrypt(JSON.stringify(secrets))
      )
    },

    list: () => repo.list(),
    get: (ref: string) => repo.findByRef(ref),

    async getSecrets(ref: string): Promise<StoredSecrets | null> {
      const enc = await repo.getSecretsEnc(ref)
      return enc === null ? null : secretsSchema.parse(JSON.parse(secretBox.decrypt(enc)))
    },
  }
}

export type ProjectRegistry = ReturnType<typeof createProjectRegistry>
