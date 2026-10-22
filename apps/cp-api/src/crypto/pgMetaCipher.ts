import CryptoJS from 'crypto-js'

export interface ConnectionTarget {
  readonly user: string
  readonly password: string
  readonly host: string
  readonly port: number
  readonly database: string
}

/** Builds a postgres URL with credentials and database name percent-encoded. */
export function buildConnectionString(target: ConnectionTarget): string {
  const user = encodeURIComponent(target.user)
  const password = encodeURIComponent(target.password)
  const database = encodeURIComponent(target.database)

  return `postgresql://${user}:${password}@${target.host}:${target.port}/${database}`
}

/**
 * Encrypts a connection string the way postgres-meta expects the `x-connection-encrypted`
 * header: crypto-js AES in passphrase mode (OpenSSL "Salted__" container), keyed by pg-meta's
 * CRYPTO_KEY. Studio forwards this value untouched from the project detail response.
 */
export function encryptConnectionString(connectionString: string, cryptoKey: string): string {
  return CryptoJS.AES.encrypt(connectionString, cryptoKey).toString()
}
