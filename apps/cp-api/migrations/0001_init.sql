CREATE TABLE admins (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash text NOT NULL,
  disabled      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE refresh_tokens (
  token_hash text PRIMARY KEY,
  admin_id   uuid NOT NULL REFERENCES admins (id) ON DELETE CASCADE,
  family_id  uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);

CREATE TABLE projects (
  ref           text PRIMARY KEY CHECK (ref ~ '^[a-z0-9]{3,40}$'),
  name          text NOT NULL,
  org_slug      text NOT NULL,
  status        text NOT NULL DEFAULT 'COMING_UP',
  desired_state text NOT NULL DEFAULT 'active',
  db_name       text NOT NULL UNIQUE,
  version       integer NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Ciphertext only (secretBox payload: keyId.iv.tag.ciphertext); never plaintext.
CREATE TABLE project_secrets (
  project_ref text PRIMARY KEY REFERENCES projects (ref) ON DELETE CASCADE,
  secrets_enc text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
