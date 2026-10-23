# M3 spike: per-project database roles

Question: can GoTrue, Storage and PostgREST run when their database logins are per-project
renamed roles instead of the fixed `supabase_auth_admin`, `supabase_storage_admin` and
`authenticator`? Reproduce with `docs/role-spike.sh` (run on the Docker host next to the
compose stack).

Versions: gotrue v2.189.0, storage-api v1.60.4, postgrest v14.12, supabase/postgres 17.6.1.136.

## Result: yes, all three run

| Service   | Login role                     | Outcome                                                         |
| --------- | ------------------------------ | --------------------------------------------------------------- |
| GoTrue    | `supabase_auth_admin_<ref>`    | 69 migrations applied, API healthy, `auth` schema has 23 tables |
| Storage   | `supabase_storage_admin_<ref>` | 61 migrations applied, server started, `storage` has 10 tables  |
| PostgREST | `authenticator_<ref>`          | Connected, schema cache loaded                                  |

## What the provisioner must do per project

Run as a superuser (`supabase_admin`; `postgres` cannot `CREATE SCHEMA ... AUTHORIZATION`
another role in this image):

1. `CREATE DATABASE proj_<ref>`; `REVOKE CONNECT ON DATABASE ... FROM PUBLIC`; grant `CONNECT`
   only to the three project roles.
2. Create the three `LOGIN` roles with unique passwords. Auth and storage admins get
   `CREATEROLE NOINHERIT`.
3. `GRANT anon, authenticated, service_role` to `authenticator_<ref>` and
   `supabase_storage_admin_<ref>`. These three NOLOGIN roles stay cluster-shared.
4. `CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin_<ref>` and the same for `storage`;
   `GRANT CREATE ON DATABASE` to both admins; `ALTER ROLE ... SET search_path` to their schema.
5. `GRANT USAGE ON SCHEMA public TO authenticator_<ref>`.

Storage needs `DB_INSTALL_ROLES=false` so it does not try to create the fixed role names.

## Not yet verified

- Cross-project isolation by an actual login attempt (the spike only revoked `CONNECT` on one DB).
  Existing databases keep the default `PUBLIC` connect until the provisioner revokes it.
- Realtime under per-project roles (still shared and multi-tenant).
- Whether GoTrue/Storage keep working after the first user signup and first upload (the spike
  only checked startup and migrations).
