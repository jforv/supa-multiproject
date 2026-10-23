import { describe, expect, it } from 'vitest'

import { ensureBootstrapAdmin } from './bootstrap.js'
import { createMemoryAdminRepo } from './memoryRepos.js'
import { verifyPassword } from './passwords.js'

describe('ensureBootstrapAdmin', () => {
  it('creates the first admin with a hashed password', async () => {
    const admins = createMemoryAdminRepo()

    const created = await ensureBootstrapAdmin(admins, {
      email: 'Root@X.io',
      password: 'a-long-password',
    })

    const row = await admins.findByEmail('root@x.io')
    expect(created).toBe(true)
    expect(row?.passwordHash).not.toContain('a-long-password')
    expect(await verifyPassword(row?.passwordHash ?? '', 'a-long-password')).toBe(true)
  })

  it('does nothing when an admin already exists', async () => {
    const admins = createMemoryAdminRepo([
      { id: 'a1', email: 'ada@x.io', passwordHash: 'h', disabled: false },
    ])

    const created = await ensureBootstrapAdmin(admins, {
      email: 'root@x.io',
      password: 'a-long-password',
    })

    expect(created).toBe(false)
    expect(await admins.count()).toBe(1)
  })

  it('does nothing when no bootstrap credentials are configured', async () => {
    const admins = createMemoryAdminRepo()

    expect(await ensureBootstrapAdmin(admins, undefined)).toBe(false)
    expect(await admins.count()).toBe(0)
  })
})
