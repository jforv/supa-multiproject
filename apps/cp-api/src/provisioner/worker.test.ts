import { describe, expect, it } from 'vitest'

import { startWorker } from './worker.js'

const IDLE_MS = 5

function scripted(results: Array<boolean | Error>) {
  let calls = 0
  return {
    get calls() {
      return calls
    },
    async runOnce() {
      const next = results[calls++]
      if (next instanceof Error) throw next
      return next ?? false
    },
  }
}

const until = async (condition: () => boolean) => {
  for (let i = 0; i < 400 && !condition(); i++) await new Promise((r) => setTimeout(r, 5))
}

describe('startWorker', () => {
  it('drains consecutive jobs without waiting between them', async () => {
    const provisioner = scripted([true, true, true])
    const worker = startWorker(provisioner, { idleMs: 10_000, onError: () => undefined })

    await until(() => provisioner.calls >= 4)
    await worker.stop()

    expect(provisioner.calls).toBeGreaterThanOrEqual(4)
  })

  it('keeps going after an error and reports it', async () => {
    const errors: string[] = []
    const provisioner = scripted([new Error('db down'), true, false])
    const worker = startWorker(provisioner, {
      idleMs: IDLE_MS,
      onError: (err) => errors.push((err as Error).message),
    })

    await until(() => provisioner.calls >= 3)
    await worker.stop()

    expect(errors).toEqual(['db down'])
    expect(provisioner.calls).toBeGreaterThanOrEqual(3)
  })

  it('stop() resolves promptly and no more jobs run afterwards', async () => {
    const provisioner = scripted([])
    const worker = startWorker(provisioner, { idleMs: IDLE_MS, onError: () => undefined })

    await worker.stop()
    const after = provisioner.calls
    await new Promise((r) => setTimeout(r, 30))

    expect(provisioner.calls).toBe(after)
  })
})
