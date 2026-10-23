-- Control database for cp-api (admins, projects, secrets). Project databases are created later.
-- The image runs init scripts as supabase_admin; cp-api connects as postgres, so it must own the DB.
CREATE DATABASE cp OWNER postgres;
