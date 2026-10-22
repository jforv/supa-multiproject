import CryptoJS from 'crypto-js'
import { describe, expect, it } from 'vitest'

import { buildConnectionString, encryptConnectionString } from './pgMetaCipher.js'

describe('buildConnectionString', () => {
  it('builds a postgres URL', () => {
    const url = buildConnectionString({
      user: 'postgres',
      password: 'pw',
      host: '127.0.0.1',
      port: 5441,
      database: 'proj_a',
    })

    expect(url).toBe('postgresql://postgres:pw@127.0.0.1:5441/proj_a')
  })

  it('percent-encodes special characters in credentials and database', () => {
    const url = buildConnectionString({
      user: 'u@ser',
      password: 'p@ss:w/rd#?',
      host: 'db',
      port: 5432,
      database: 'my db',
    })
    const parsed = new URL(url)

    expect(decodeURIComponent(parsed.username)).toBe('u@ser')
    expect(decodeURIComponent(parsed.password)).toBe('p@ss:w/rd#?')
    expect(decodeURIComponent(parsed.pathname.slice(1))).toBe('my db')
    expect(parsed.host).toBe('db:5432')
  })
})

describe('encryptConnectionString', () => {
  it('produces a value postgres-meta can decrypt with the shared key', () => {
    const conn = 'postgresql://postgres:pw@127.0.0.1:5441/proj_a'

    const encrypted = encryptConnectionString(conn, 'meta-crypto-key')

    expect(CryptoJS.AES.decrypt(encrypted, 'meta-crypto-key').toString(CryptoJS.enc.Utf8)).toBe(
      conn
    )
  })

  it('uses the OpenSSL "Salted__" container that crypto-js passphrase mode emits', () => {
    const encrypted = encryptConnectionString('postgresql://x', 'k')

    expect(encrypted.startsWith('U2FsdGVkX1')).toBe(true)
  })

  it('does not contain the password in the output', () => {
    const encrypted = encryptConnectionString('postgresql://u:hunter2@h/db', 'k')

    expect(encrypted).not.toContain('hunter2')
  })

  it('cannot be decrypted with a different key', () => {
    const conn = 'postgresql://u:p@h/db'
    const encrypted = encryptConnectionString(conn, 'right-key')

    // crypto-js either throws on malformed UTF-8 or returns garbage/empty; never the original
    const decryptWithWrongKey = () =>
      CryptoJS.AES.decrypt(encrypted, 'wrong-key').toString(CryptoJS.enc.Utf8)
    let result = ''
    try {
      result = decryptWithWrongKey()
    } catch {
      result = 'threw'
    }

    expect(result).not.toBe(conn)
  })
})
