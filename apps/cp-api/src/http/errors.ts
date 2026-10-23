import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

/** Every error body carries `message`: Studio reads `error.message` and crashes without it. */
export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    message: string,
    readonly extra: Readonly<Record<string, unknown>> = {}
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export function errorResponse(c: Context, err: ApiError): Response {
  return c.json({ ...err.extra, message: err.message }, err.status)
}
