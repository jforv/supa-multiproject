import type { Context } from 'hono'

/**
 * Endpoints Studio calls on load that we answer with an empty-but-valid body so its UI doesn't
 * error. Each moves out of this table into a real route when its feature lands.
 */
export interface Stub {
  readonly methods?: readonly string[]
  readonly pattern: RegExp
  readonly body?: unknown
  /** Computed body, for stubs that echo the request. Wins over `body`. */
  readonly respond?: (c: Context) => Promise<unknown>
}

const NOT_SET_UP_STORAGE = {
  fileSizeLimit: 52_428_800,
  features: { imageTransformation: { enabled: false }, s3Protocol: { enabled: false } },
}

export const STUBS: readonly Stub[] = [
  { methods: ['GET', 'POST'], pattern: /^\/platform\/profile\/audit-login$/, body: {} },
  { pattern: /^\/platform\/notifications$/, body: [] },
  {
    pattern: /^\/platform\/notifications\/summary$/,
    body: { unread_count: 0, has_warning: false, has_critical: false },
  },
  { pattern: /^\/platform\/telemetry\/feature-flags$/, body: {} },
  { pattern: /^\/platform\/projects-resource-warnings$/, body: [] },
  { pattern: /^\/platform\/stripe\/invoices\/overdue$/, body: [] },
  { pattern: /^\/platform\/integrations\/github\/authorization$/, body: { authorization: null } },
  { pattern: /^\/platform\/integrations\//, body: [] },
  { pattern: /^\/platform\/organizations\/[^/]+\/oauth\//, body: [] },
  { pattern: /^\/platform\/organizations\/[^/]+\/entitlements$/, body: { entitlements: [] } },
  { pattern: /^\/platform\/projects\/[^/]+\/run-lints$/, body: [] },
  { pattern: /^\/platform\/projects\/[^/]+\/config\/storage$/, body: NOT_SET_UP_STORAGE },
  { pattern: /^\/platform\/auth\/[^/]+\/config$/, body: {} },
  { pattern: /^\/v1\/projects\/[^/]+\/(api-keys|branches)$/, body: [] },
  { pattern: /^\/v1\/projects\/[^/]+\/upgrade\/status$/, body: { databaseUpgradeStatus: null } },
  { pattern: /^\/platform\/projects\/[^/]+\/load-balancers$/, body: [] },
  {
    pattern: /^\/platform\/database\/[^/]+\/backups$/,
    body: {
      backups: [],
      physicalBackupData: {},
      pitr_enabled: false,
      region: 'local',
      walg_enabled: false,
    },
  },
  {
    pattern: /^\/platform\/projects\/[^/]+\/billing\/addons$/,
    body: { available_addons: [], selected_addons: [] },
  },
  { pattern: /^\/platform\/projects\/[^/]+\/analytics\/endpoints\//, body: { result: [] } },
  {
    methods: ['POST'],
    pattern: /^\/platform\/organizations\/[^/]+\/available-versions$/,
    body: {
      available_versions: [{ postgres_engine: '17', release_channel: 'ga', version: '17.6.1.136' }],
    },
  },
  {
    methods: ['GET', 'POST'],
    pattern: /^\/v1\/projects\/[^/]+\/network-bans\/retrieve$/,
    body: { banned_ipv4_addresses: [] },
  },
  // SQL snippets: real storage arrives with the content milestone; these keep the editor usable.
  { pattern: /^\/platform\/projects\/[^/]+\/content$/, body: { data: [] } },
  {
    pattern: /^\/platform\/projects\/[^/]+\/content\/folders/,
    body: { data: { folders: [], contents: [] } },
  },
  {
    pattern: /^\/platform\/projects\/[^/]+\/content\/count/,
    body: { shared: 0, favorites: 0, private: 0 },
  },
  {
    methods: ['PUT', 'POST'],
    pattern: /^\/platform\/projects\/[^/]+\/content$/,
    respond: (c) => c.req.json().catch(() => ({})),
  },
]

const DEFAULT_METHODS = ['GET']

export function findStub(method: string, path: string): Stub | undefined {
  return STUBS.find((s) => (s.methods ?? DEFAULT_METHODS).includes(method) && s.pattern.test(path))
}
