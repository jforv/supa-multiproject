import { describe, expect, it } from 'vitest'

import { createSecretBox } from './secretBox.js'

const keyA = Buffer.alloc(32, 1)
const keyB = Buffer.alloc(32, 2)

describe('secretBox', () => {
  it('round-trips plaintext, including unicode and empty strings', () => {
    const box = createSecretBox({ activeKeyId: 'k1', keys: { k1: keyA } })

    for (const plaintext of ['hello', '', 'pässwörd-日本語-🔐']) {
      expect(box.decrypt(box.encrypt(plaintext))).toBe(plaintext)
    }
  })

  it('produces different ciphertext for the same plaintext', () => {
    const box = createSecretBox({ activeKeyId: 'k1', keys: { k1: keyA } })

    expect(box.encrypt('same')).not.toBe(box.encrypt('same'))
  })

  it('does not contain the plaintext in the payload', () => {
    const box = createSecretBox({ activeKeyId: 'k1', keys: { k1: keyA } })

    expect(box.encrypt('super-secret-value')).not.toContain('super-secret-value')
  })

  it('rejects a tampered payload', () => {
    const box = createSecretBox({ activeKeyId: 'k1', keys: { k1: keyA } })
    const [keyId, iv, tag, ciphertext] = box.encrypt('payload').split('.')
    const flipped = Buffer.from(ciphertext ?? '', 'base64')
    flipped[0] = (flipped[0] ?? 0) ^ 0xff

    const tampered = [keyId, iv, tag, flipped.toString('base64')].join('.')

    expect(() => box.decrypt(tampered)).toThrow()
  })

  it('rejects decryption with the wrong key', () => {
    const writer = createSecretBox({ activeKeyId: 'k1', keys: { k1: keyA } })
    const reader = createSecretBox({ activeKeyId: 'k1', keys: { k1: keyB } })

    expect(() => reader.decrypt(writer.encrypt('x'))).toThrow()
  })

  it('decrypts old payloads after key rotation', () => {
    const old = createSecretBox({ activeKeyId: 'k1', keys: { k1: keyA } })
    const rotated = createSecretBox({ activeKeyId: 'k2', keys: { k1: keyA, k2: keyB } })
    const legacy = old.encrypt('legacy')

    expect(rotated.decrypt(legacy)).toBe('legacy')
    expect(rotated.encrypt('fresh').startsWith('k2.')).toBe(true)
  })

  it('rejects an unknown key id and malformed payloads', () => {
    const box = createSecretBox({ activeKeyId: 'k1', keys: { k1: keyA } })

    expect(() => box.decrypt('nope.aa.bb.cc')).toThrow(/key/i)
    expect(() => box.decrypt('not-a-payload')).toThrow(/malformed/i)
  })

  it('refuses keys that are not 32 bytes', () => {
    expect(() => createSecretBox({ activeKeyId: 'k1', keys: { k1: Buffer.alloc(16) } })).toThrow(
      /32 bytes/
    )
  })

  it('refuses an active key id that has no key', () => {
    expect(() => createSecretBox({ activeKeyId: 'missing', keys: { k1: keyA } })).toThrow(/active/i)
  })
})
