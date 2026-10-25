import type Docker from 'dockerode'

import {
  specHash,
  type ContainerInfo,
  type ContainerRuntime,
  type ContainerSpec,
  type ServiceRole,
} from './ports.js'

const LABEL_REF = 'cp.ref'
const LABEL_ROLE = 'cp.role'
const LABEL_HASH = 'cp.hash'
const BYTES_PER_MB = 1024 * 1024
const STOP_GRACE_SECONDS = 5
const HTTP_NOT_FOUND = 404
const HTTP_NOT_MODIFIED = 304

export interface DockerRuntimeOptions {
  /** User-defined network the containers join; omit for Docker's default bridge. */
  readonly network?: string
}

const statusOf = (err: unknown) => (err as { statusCode?: number }).statusCode

/** Runs `fn`, treating the given HTTP statuses (container missing, already stopped) as success. */
async function tolerate(statuses: readonly number[], fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    const status = statusOf(err)
    if (status === undefined || !statuses.includes(status)) throw err
  }
}

export function createDockerRuntime(
  docker: Docker,
  options: DockerRuntimeOptions = {}
): ContainerRuntime {
  async function inspect(name: string) {
    try {
      return await docker.getContainer(name).inspect()
    } catch (err) {
      if (statusOf(err) === HTTP_NOT_FOUND) return null
      throw err
    }
  }

  async function pullIfMissing(image: string): Promise<void> {
    try {
      await docker.getImage(image).inspect()
      return
    } catch (err) {
      if (statusOf(err) !== HTTP_NOT_FOUND) throw err
    }
    const stream = await docker.pull(image)
    await new Promise<void>((resolve, reject) => {
      docker.modem.followProgress(stream, (err: Error | null) => (err ? reject(err) : resolve()))
    })
  }

  async function create(spec: ContainerSpec, hash: string): Promise<void> {
    await pullIfMissing(spec.image)
    const container = await docker.createContainer({
      name: spec.name,
      Image: spec.image,
      Env: Object.entries(spec.env).map(([k, v]) => `${k}=${v}`),
      ...(spec.cmd ? { Cmd: [...spec.cmd] } : {}),
      Labels: { [LABEL_REF]: spec.ref, [LABEL_ROLE]: spec.role, [LABEL_HASH]: hash },
      HostConfig: {
        Memory: spec.memoryMb * BYTES_PER_MB,
        RestartPolicy: { Name: 'unless-stopped' },
        ...(options.network ? { NetworkMode: options.network } : {}),
      },
    })
    await container.start()
  }

  const remove = (name: string) =>
    tolerate([HTTP_NOT_FOUND], () => docker.getContainer(name).remove({ force: true }))

  return {
    async ensure(spec) {
      const hash = specHash(spec)
      const current = await inspect(spec.name)
      if (current?.Config.Labels[LABEL_HASH] === hash) {
        if (!current.State.Running) {
          await tolerate([HTTP_NOT_MODIFIED], () => docker.getContainer(spec.name).start())
        }
        return
      }
      if (current) await remove(spec.name)
      await create(spec, hash)
    },

    stop: (name) =>
      tolerate([HTTP_NOT_FOUND, HTTP_NOT_MODIFIED], () =>
        docker.getContainer(name).stop({ t: STOP_GRACE_SECONDS })
      ),

    remove,

    async list(ref) {
      const found = await docker.listContainers({
        all: true,
        filters: { label: [`${LABEL_REF}=${ref}`] },
      })
      return found.map(
        (c): ContainerInfo => ({
          name: (c.Names[0] ?? '').replace(/^\//, ''),
          ref,
          role: (c.Labels[LABEL_ROLE] ?? '') as ServiceRole,
          state: c.State === 'running' ? 'running' : 'stopped',
          specHash: c.Labels[LABEL_HASH] ?? '',
        })
      )
    },
  }
}
