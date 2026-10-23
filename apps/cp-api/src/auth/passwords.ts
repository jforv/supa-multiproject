import { hash, verify } from '@node-rs/argon2'

// @node-rs/argon2 const enums are awkward under verbatimModuleSyntax; 2 === Algorithm.Argon2id.
const ARGON2ID = 2
const OPTIONS = { algorithm: ARGON2ID, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS)
}

/** A malformed stored hash is simply a failed login, never an exception. */
export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password)
  } catch {
    return false
  }
}
