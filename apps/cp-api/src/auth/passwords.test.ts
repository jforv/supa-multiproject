import { describe, expect, it } from 'vitest'

import { hashPassword, verifyPassword } from './passwords.js'

describe('passwords', () => {
  it('hashes with argon2id', async () => {
    const hash = await hashPassword('correct horse battery')

    expect(hash.startsWith('$argon2id$')).toBe(true)
  })

  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery')

    expect(await verifyPassword(hash, 'correct horse battery')).toBe(true)
    expect(await verifyPassword(hash, 'wrong password')).toBe(false)
  })

  it('salts every hash', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'))
  })

  it('returns false for a malformed stored hash instead of throwing', async () => {
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false)
  })
})
