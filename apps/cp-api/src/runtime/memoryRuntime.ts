import {
  specHash,
  type ContainerInfo,
  type ContainerRuntime,
  type ContainerSpec,
  type ContainerState,
} from './ports.js'

interface Entry {
  readonly spec: ContainerSpec
  readonly hash: string
  readonly state: ContainerState
}

/** In-memory stand-in for Docker: same observable behavior as the real runtime. */
export function createMemoryRuntime(): ContainerRuntime {
  let containers: ReadonlyMap<string, Entry> = new Map()
  const put = (name: string, entry: Entry) => {
    containers = new Map(containers).set(name, entry)
  }

  return {
    async ensure(spec) {
      // Changed or new: (re)build. Unchanged: keep it and make sure it runs.
      put(spec.name, { spec, hash: specHash(spec), state: 'running' })
    },

    async stop(name) {
      const current = containers.get(name)
      if (current) put(name, { ...current, state: 'stopped' })
    },

    async remove(name) {
      const next = new Map(containers)
      next.delete(name)
      containers = next
    },

    async list(ref) {
      return [...containers.values()]
        .filter((c) => c.spec.ref === ref)
        .map(
          (c): ContainerInfo => ({
            name: c.spec.name,
            ref: c.spec.ref,
            role: c.spec.role,
            state: c.state,
            specHash: c.hash,
          })
        )
    },
  }
}
