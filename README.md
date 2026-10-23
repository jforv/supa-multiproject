# supa-multiproject

A control plane that lets **stock, unmodified Supabase Studio** manage many projects on one server. Studio runs in platform mode against `cp-api`, which implements the slice of the platform API Studio needs. Each project is a database on a shared Postgres cluster.

## Status

| Milestone                                                 | State       |
| --------------------------------------------------------- | ----------- |
| M0 admin auth, project registry, pg-meta passthrough      | done        |
| M1 create/delete projects from the UI (durable job queue) | done        |
| M2 SQL snippets and folders stored per project            | done        |
| M3 per-project Auth/Storage/REST, gateway, Realtime       | not started |
| M4 pause/restore, backups, settings                       | not started |

Until M3 the project overview shows "Unhealthy": Studio expects PostgREST, Auth, Realtime and Storage to report healthy, and `cp-api` only reports what really exists (the database).

## Layout

- `apps/cp-api` – Hono + TypeScript API (auth, projects, provisioner, content)
- `studio/Dockerfile` – builds stock Studio from a pinned upstream commit
- `deploy/` – Docker Compose stack and `init-env.sh`

## Run it

```sh
cd deploy
./init-env.sh <host-browsers-use> <admin-email>   # writes .env with fresh secrets
docker compose up -d --build
```

Studio is on `STUDIO_PORT`; sign in with the admin email and `CP_BOOTSTRAP_ADMIN_PASSWORD` from `.env`. `NEXT_PUBLIC_*` values are baked into Studio at build time, so changing the host means rebuilding it.

## Develop

Needs Node 22 and pnpm 11.

```sh
pnpm install
pnpm typecheck
CP_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/cp_test pnpm test
```

Without `CP_TEST_DATABASE_URL` the Postgres integration tests are skipped. The role must be allowed to `CREATE DATABASE`.

## Known limits

- Projects share the cluster's `postgres` role. Per-project roles are proven to work with
  GoTrue, Storage and PostgREST ([spike](docs/m3-role-spike.md)); wiring them in is M3.
- The database password entered in Studio's "New project" form is ignored.
- Private snippets and folders belong to one admin; there is no per-project access control.
