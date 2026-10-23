const DEFAULT_IDLE_MS = 1000

export interface WorkerOptions {
  readonly idleMs?: number
  readonly onError: (err: unknown) => void
}

/**
 * Polls the provisioner until stopped: back-to-back while jobs exist, `idleMs` apart when the
 * queue is empty or an error occurred. `stop()` resolves once the current job has finished and
 * cuts any idle wait short.
 */
export function startWorker(
  provisioner: { runOnce(): Promise<boolean> },
  { idleMs = DEFAULT_IDLE_MS, onError }: WorkerOptions
) {
  let stopped = false
  let wake: (() => void) | undefined

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms)
      wake = () => {
        clearTimeout(timer)
        resolve()
      }
    })

  const loop = (async () => {
    while (!stopped) {
      try {
        if (!(await provisioner.runOnce())) await sleep(idleMs)
      } catch (err) {
        onError(err)
        await sleep(idleMs)
      }
    }
  })()

  return {
    async stop(): Promise<void> {
      stopped = true
      wake?.()
      await loop
    },
  }
}
