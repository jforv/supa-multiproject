import { randomUUID } from 'node:crypto'

import { hashPassword } from './passwords.js'
import type { AdminRepo } from './ports.js'

export interface BootstrapCredentials {
  readonly email: string
  readonly password: string
}

/** Seeds the first admin from env on an empty table. Returns true if one was created. */
export async function ensureBootstrapAdmin(
  admins: AdminRepo,
  credentials: BootstrapCredentials | undefined
): Promise<boolean> {
  if (!credentials || (await admins.count()) > 0) return false

  await admins.insert({
    id: randomUUID(),
    email: credentials.email.toLowerCase(),
    passwordHash: await hashPassword(credentials.password),
    disabled: false,
  })
  return true
}
