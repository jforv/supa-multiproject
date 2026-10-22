import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY_BYTES = 32
const IV_BYTES = 12
const SEPARATOR = '.'
const PAYLOAD_PARTS = 4

export interface SecretBoxOptions {
  readonly activeKeyId: string
  readonly keys: Readonly<Record<string, Buffer>>
}

export interface SecretBox {
  /** Returns `keyId.iv.tag.ciphertext` (base64 parts). A fresh random IV is used every call. */
  encrypt(plaintext: string): string
  decrypt(payload: string): string
}

function assertKeys({ activeKeyId, keys }: SecretBoxOptions): void {
  for (const [id, key] of Object.entries(keys)) {
    if (id.includes(SEPARATOR)) {
      throw new Error(`Key id "${id}" must not contain "${SEPARATOR}"`)
    }
    if (key.length !== KEY_BYTES) {
      throw new Error(`Key "${id}" must be ${KEY_BYTES} bytes`)
    }
  }
  if (!(activeKeyId in keys)) {
    throw new Error(`Active key id "${activeKeyId}" has no key`)
  }
}

/** AES-256-GCM envelope with key ids so the master key can rotate without re-encrypting at once. */
export function createSecretBox(options: SecretBoxOptions): SecretBox {
  assertKeys(options)
  const { activeKeyId, keys } = options

  return {
    encrypt(plaintext) {
      const key = keys[activeKeyId] as Buffer
      const iv = randomBytes(IV_BYTES)
      const cipher = createCipheriv(ALGORITHM, key, iv)
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])

      return [
        activeKeyId,
        iv.toString('base64'),
        cipher.getAuthTag().toString('base64'),
        ciphertext.toString('base64'),
      ].join(SEPARATOR)
    },

    decrypt(payload) {
      const parts = payload.split(SEPARATOR)
      if (parts.length !== PAYLOAD_PARTS) {
        throw new Error('Malformed secret payload')
      }
      const [keyId = '', iv = '', tag = '', ciphertext = ''] = parts
      const key = keys[keyId]
      if (key === undefined) {
        throw new Error(`Unknown encryption key id "${keyId}"`)
      }

      const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'))
      decipher.setAuthTag(Buffer.from(tag, 'base64'))

      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8')
    },
  }
}
