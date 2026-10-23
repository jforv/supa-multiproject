-- Durable work queue for the provisioner. A job stays 'running' under a lease; if the process
-- dies, the lease expires and another claim picks the job up again (steps are idempotent).
create table jobs (
  id uuid primary key default gen_random_uuid(),
  project_ref text not null,
  kind text not null check (kind in ('create', 'delete')),
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  attempts integer not null default 0,
  last_error text,
  run_after timestamptz not null default now(),
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_claim_idx on jobs (status, run_after);
