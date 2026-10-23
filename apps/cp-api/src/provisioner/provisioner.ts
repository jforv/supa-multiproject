import type { ProjectRegistry } from '../registry/registry.js'
import type { Job, JobRepo, ProjectDbAdmin } from './ports.js'

const DEFAULT_LEASE_MS = 60_000
const DEFAULT_MAX_ATTEMPTS = 5
const BACKOFF_BASE_MS = 2000
const BACKOFF_CAP_MS = 60_000

export interface ProvisionerDeps {
  readonly jobs: JobRepo
  readonly registry: ProjectRegistry
  readonly dbAdmin: ProjectDbAdmin
  readonly leaseMs?: number
  readonly maxAttempts?: number
  readonly backoffMs?: (attempt: number) => number
}

const defaultBackoff = (attempt: number) =>
  Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), BACKOFF_CAP_MS)

/**
 * Runs queued create/delete jobs. Every step is idempotent, so a job can be repeated after a
 * crash: the lease on a claimed job expires and the next `runOnce` picks it up again.
 */
export function createProvisioner(deps: ProvisionerDeps) {
  const { jobs, registry, dbAdmin } = deps
  const leaseMs = deps.leaseMs ?? DEFAULT_LEASE_MS
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const backoffMs = deps.backoffMs ?? defaultBackoff

  async function runCreate(ref: string, now: Date): Promise<void> {
    const project = await registry.get(ref)
    // Gone, or a delete was requested first: nothing to build.
    if (!project || project.status === 'GOING_DOWN') return
    await dbAdmin.createDatabase(project.dbName)
    await registry.setStatus(ref, 'ACTIVE_HEALTHY', now)
  }

  async function runDelete(ref: string): Promise<void> {
    const project = await registry.get(ref)
    if (!project) return
    await dbAdmin.dropDatabase(project.dbName)
    await registry.remove(ref)
  }

  async function onFailure(job: Job, err: unknown, now: Date): Promise<void> {
    const message = err instanceof Error ? err.message : String(err)
    if (job.attempts < maxAttempts) {
      await jobs.retry(job.id, message, new Date(now.getTime() + backoffMs(job.attempts)), now)
      return
    }
    await jobs.fail(job.id, message, now)
    // A project that never came up is parked as INIT_FAILED so it can still be deleted.
    if (job.kind === 'create') await registry.setStatus(job.projectRef, 'INIT_FAILED', now)
  }

  return {
    /** Processes at most one job. Returns false when nothing was runnable. */
    async runOnce(now: Date = new Date()): Promise<boolean> {
      const job = await jobs.claim(now, leaseMs)
      if (!job) return false
      try {
        if (job.kind === 'create') await runCreate(job.projectRef, now)
        else await runDelete(job.projectRef)
        await jobs.complete(job.id, now)
      } catch (err) {
        await onFailure(job, err, now)
      }
      return true
    },
  }
}

export type Provisioner = ReturnType<typeof createProvisioner>
