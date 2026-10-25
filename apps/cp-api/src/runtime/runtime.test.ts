import { randomUUID } from 'node:crypto'
import Docker from 'dockerode'
import { afterAll, describe, expect, it } from 'vitest'

import { createDockerRuntime } from './dockerRuntime.js'
import { createMemoryRuntime } from './memoryRuntime.js'
import { specHash, type ContainerRuntime, type ContainerSpec } from './ports.js'

// The same contract runs against the in-memory fake and (when CP_TEST_DOCKER=1) a real Docker
// daemon, so the fake cannot drift from what Docker does. Needs a small image already pulled.
const useDocker = process.env['CP_TEST_DOCKER'] === '1'
const IMAGE = process.env['CP_TEST_DOCKER_IMAGE'] ?? 'postgres:16-alpine'
const RUN = randomUUID().slice(0, 8)

const spec = (over: Partial<ContainerSpec> = {}): ContainerSpec => ({
  name: `cptest-${RUN}-${randomUUID().slice(0, 6)}`,
  image: IMAGE,
  ref: `ref${randomUUID().slice(0, 8)}`,
  role: 'auth',
  env: { A: '1' },
  // PID 1 ignores SIGTERM unless it traps it, which would make every stop wait out the grace period.
  cmd: ['sh', '-c', "trap 'exit 0' TERM; while true; do sleep 1; done"],
  memoryMb: 64,
  ...over,
})

const suites: [string, () => ContainerRuntime, boolean][] = [
  ['memory runtime', () => createMemoryRuntime(), true],
  ['docker runtime', () => createDockerRuntime(new Docker()), useDocker],
]

describe('specHash', () => {
  it('ignores env key order but notices any real change', () => {
    const a = spec({ name: 'n', env: { A: '1', B: '2' } })

    expect(specHash(a)).toBe(specHash({ ...a, env: { B: '2', A: '1' } }))
    expect(specHash(a)).not.toBe(specHash({ ...a, env: { A: '1', B: '3' } }))
    expect(specHash(a)).not.toBe(specHash({ ...a, memoryMb: 128 }))
    expect(specHash(a)).not.toBe(specHash({ ...a, image: 'other' }))
  })
})

describe.each(suites)('%s', (_label, make, enabled) => {
  // A cold image pull on a fresh CI runner takes longer than vitest's default 5s.
  describe.skipIf(!enabled)('contract', { timeout: 60_000 }, () => {
    const runtime = make()
    const created: string[] = []
    const ensure = async (s: ContainerSpec) => {
      created.push(s.name)
      await runtime.ensure(s)
    }
    afterAll(async () => {
      for (const name of created) await runtime.remove(name)
    })

    it('creates and starts a container, tagged with its project and role', async () => {
      const s = spec({ role: 'rest' })

      await ensure(s)

      expect(await runtime.list(s.ref)).toEqual([
        { name: s.name, ref: s.ref, role: 'rest', state: 'running', specHash: specHash(s) },
      ])
    })

    it('is idempotent for an unchanged spec', async () => {
      const s = spec()

      await ensure(s)
      await ensure(s)

      expect(await runtime.list(s.ref)).toHaveLength(1)
    })

    it('rebuilds the container when the spec changes', async () => {
      const s = spec()
      await ensure(s)

      const next = { ...s, env: { A: '2' } }
      await ensure(next)

      const [info] = await runtime.list(s.ref)
      expect(info?.specHash).toBe(specHash(next))
      expect(info?.state).toBe('running')
    })

    it('stops a container and ensure starts it again', async () => {
      const s = spec()
      await ensure(s)

      await runtime.stop(s.name)
      expect((await runtime.list(s.ref))[0]?.state).toBe('stopped')
      await ensure(s)

      expect((await runtime.list(s.ref))[0]?.state).toBe('running')
    })

    it('lists only the containers of the asked project', async () => {
      const mine = spec({ role: 'auth' })
      const other = spec({ ref: `other${RUN}` })
      await ensure(mine)
      await ensure(other)

      expect((await runtime.list(mine.ref)).map((c) => c.name)).toEqual([mine.name])
      expect(await runtime.list(`none${RUN}`)).toEqual([])
    })

    it('removes containers and tolerates missing ones', async () => {
      const s = spec()
      await ensure(s)

      await runtime.remove(s.name)
      await runtime.remove(s.name)
      await runtime.stop(s.name)

      expect(await runtime.list(s.ref)).toEqual([])
    })
  })
})
