import { createHash } from 'node:crypto'

/** Which per-project service a container runs. */
export type ServiceRole = 'auth' | 'rest' | 'storage'

export interface ContainerSpec {
  readonly name: string
  readonly image: string
  readonly ref: string
  readonly role: ServiceRole
  readonly env: Readonly<Record<string, string>>
  readonly cmd?: readonly string[]
  readonly memoryMb: number
}

export type ContainerState = 'running' | 'stopped'

export interface ContainerInfo {
  readonly name: string
  readonly ref: string
  readonly role: ServiceRole
  readonly state: ContainerState
  /** Hash of the spec the container was built from; `ensure` rebuilds when it changes. */
  readonly specHash: string
}

/** Runs the per-project service containers. Every call must be safe to repeat. */
export interface ContainerRuntime {
  /** Makes the container exist, match `spec` and be running. Rebuilds it if the spec changed. */
  ensure(spec: ContainerSpec): Promise<void>
  /** Stops the container but keeps it. No-op when it is missing. */
  stop(name: string): Promise<void>
  /** Stops and deletes the container. No-op when it is missing. */
  remove(name: string): Promise<void>
  /** Containers that belong to the project, in any state. */
  list(ref: string): Promise<readonly ContainerInfo[]>
}

/** Stable across key order, so equal specs always hash equal. */
export function specHash(spec: ContainerSpec): string {
  const env = Object.entries(spec.env).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const canonical = JSON.stringify([
    spec.name,
    spec.image,
    spec.ref,
    spec.role,
    env,
    spec.cmd ?? null,
    spec.memoryMb,
  ])
  return createHash('sha256').update(canonical).digest('hex')
}
