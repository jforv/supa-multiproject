-- Saved SQL snippets (and other Studio "content") plus their folders, scoped per project.
create table content_folders (
  id uuid primary key default gen_random_uuid(),
  project_ref text not null references projects (ref)
    on delete cascade,
  owner_id uuid not null references admins (id)
    on delete cascade,
  name text not null,
  parent_id uuid references content_folders (id)
    on delete cascade,
  created_at timestamptz not null default now()
);

create index content_folders_project_idx on content_folders (project_ref, parent_id);

create table content (
  project_ref text not null references projects (ref)
    on delete cascade,
  -- Studio generates the id client-side, so it is unique per project, not globally.
  id uuid not null,
  owner_id uuid not null references admins (id)
    on delete cascade,
  updated_by uuid references admins (id)
    on delete set null,
  type text not null check (type in ('sql', 'report', 'log_sql', 'notebook')),
  visibility text not null default 'user' check (
    visibility in ('user', 'project', 'org', 'public')
  ),
  name text not null,
  description text,
  favorite boolean not null default false,
  folder_id uuid references content_folders (id)
    on delete cascade,
  body jsonb,
  inserted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_ref, id)
);

create index content_folder_idx on content (project_ref, folder_id);
