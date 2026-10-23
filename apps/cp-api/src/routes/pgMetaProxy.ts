import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

import { ApiError } from '../http/errors.js'

export interface PgMetaTarget {
  readonly url: string
  /** Value for the `x-connection-encrypted` header (already encrypted for this project). */
  readonly connectionEncrypted: string
  readonly fetch: typeof fetch
}

const BODYLESS_METHODS = new Set(['GET', 'HEAD'])
const DEFAULT_CONTENT_TYPE = 'application/json'
const HTTP_ERROR_FLOOR = 400

/** Studio reads `error.message`; postgres-meta sometimes only sends `error`. */
function withMessage(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return body
    const record = parsed as Record<string, unknown>
    if (typeof record['message'] === 'string') return body
    const error = record['error']
    return JSON.stringify({
      ...record,
      message: typeof error === 'string' ? error : 'pg-meta error',
    })
  } catch {
    return body
  }
}

/** Relays one request to the shared postgres-meta, scoped to a project's database. */
export async function proxyPgMeta(c: Context, restPath: string, target: PgMetaTarget) {
  const search = new URL(c.req.url).search
  const method = c.req.method
  const body = BODYLESS_METHODS.has(method) ? undefined : await c.req.arrayBuffer()

  let upstream: Response
  try {
    upstream = await target.fetch(`${target.url}${restPath}${search}`, {
      method,
      headers: {
        'content-type': c.req.header('content-type') ?? DEFAULT_CONTENT_TYPE,
        'x-connection-encrypted': target.connectionEncrypted,
      },
      ...(body === undefined ? {} : { body }),
    })
  } catch {
    throw new ApiError(502, 'postgres-meta is unreachable')
  }

  const status = upstream.status as ContentfulStatusCode
  const contentType = upstream.headers.get('content-type') ?? DEFAULT_CONTENT_TYPE
  const text = await upstream.text()
  const out = upstream.status >= HTTP_ERROR_FLOOR ? withMessage(text) : text
  return c.body(out, status, { 'content-type': contentType })
}
