#!/bin/bash
# M3 spike: do GoTrue / Storage / PostgREST run under per-project suffixed roles?
set -u
cd ~/supa-multiproject/deploy
PGPASS=$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)
NET=supa-multiproject_default
DB=spike_a
SUF=a
psql_() { docker exec -i supa-multiproject-db-1 psql -U supabase_admin -v ON_ERROR_STOP=1 "$@"; }
PW=spikepw123

psql_ -d postgres <<SQL
DROP DATABASE IF EXISTS $DB WITH (FORCE);
CREATE DATABASE $DB;
DROP ROLE IF EXISTS supabase_auth_admin_$SUF, supabase_storage_admin_$SUF, authenticator_$SUF;
SQL
psql_ -d postgres <<SQL
CREATE ROLE supabase_auth_admin_$SUF LOGIN PASSWORD '$PW' NOINHERIT CREATEROLE;
CREATE ROLE supabase_storage_admin_$SUF LOGIN PASSWORD '$PW' NOINHERIT CREATEROLE;
CREATE ROLE authenticator_$SUF LOGIN PASSWORD '$PW' NOINHERIT;
GRANT anon, authenticated, service_role TO authenticator_$SUF;
GRANT anon, authenticated, service_role TO supabase_storage_admin_$SUF;
REVOKE CONNECT ON DATABASE $DB FROM PUBLIC;
GRANT CONNECT ON DATABASE $DB TO supabase_auth_admin_$SUF, supabase_storage_admin_$SUF, authenticator_$SUF;
SQL
psql_ -d $DB <<SQL
CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin_$SUF;
CREATE SCHEMA storage AUTHORIZATION supabase_storage_admin_$SUF;
GRANT CREATE ON DATABASE $DB TO supabase_auth_admin_$SUF, supabase_storage_admin_$SUF;
ALTER ROLE supabase_auth_admin_$SUF SET search_path = auth;
ALTER ROLE supabase_storage_admin_$SUF SET search_path = storage;
GRANT USAGE ON SCHEMA public TO authenticator_$SUF;
SQL

echo "=== GoTrue ==="
docker rm -f spike-auth >/dev/null 2>&1
docker run -d --name spike-auth --network $NET \
  -e GOTRUE_API_HOST=0.0.0.0 -e GOTRUE_API_PORT=9999 -e API_EXTERNAL_URL=http://localhost \
  -e GOTRUE_DB_DRIVER=postgres \
  -e GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin_$SUF:$PW@db:5432/$DB" \
  -e GOTRUE_SITE_URL=http://localhost -e GOTRUE_JWT_SECRET=spike-secret-spike-secret-spike-secret-1234 \
  -e GOTRUE_JWT_EXP=3600 -e GOTRUE_DISABLE_SIGNUP=false \
  supabase/gotrue:v2.189.0 >/dev/null
sleep 20
docker logs spike-auth 2>&1 | tail -15
docker exec spike-auth wget -qO- http://127.0.0.1:9999/health 2>&1 | head -c 300; echo
psql_ -d $DB -Atc "select count(*) as auth_tables from information_schema.tables where table_schema='auth'"
psql_ -d $DB -Atc "select count(*) as migrations from auth.schema_migrations"

echo "=== Storage ==="
docker rm -f spike-storage >/dev/null 2>&1
docker run -d --name spike-storage --network $NET \
  -e SERVER_PORT=5000 -e AUTH_JWT_SECRET=spike-secret-spike-secret-spike-secret-1234 \
  -e AUTH_JWT_ALGORITHM=HS256 \
  -e DATABASE_URL="postgres://supabase_storage_admin_$SUF:$PW@db:5432/$DB" \
  -e DB_INSTALL_ROLES=false -e STORAGE_BACKEND=file -e FILE_STORAGE_BACKEND_PATH=/var/lib/storage \
  -e TENANT_ID=spike -e REGION=local -e GLOBAL_S3_BUCKET=spike -e ENABLE_IMAGE_TRANSFORMATION=false \
  -e PGRST_JWT_SECRET=spike-secret-spike-secret-spike-secret-1234 \
  supabase/storage-api:v1.60.4 >/dev/null
sleep 20
docker logs spike-storage 2>&1 | tail -15
psql_ -d $DB -Atc "select count(*) as storage_tables from information_schema.tables where table_schema='storage'"
psql_ -d $DB -Atc "select count(*) as migrations from storage.migrations"

echo "=== PostgREST ==="
docker rm -f spike-rest >/dev/null 2>&1
docker run -d --name spike-rest --network $NET \
  -e PGRST_DB_URI="postgres://authenticator_$SUF:$PW@db:5432/$DB" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon \
  -e PGRST_JWT_SECRET=spike-secret-spike-secret-spike-secret-1234 \
  postgrest/postgrest:v14.12 >/dev/null
sleep 8
docker logs spike-rest 2>&1 | tail -8

echo "=== cleanup ==="
docker rm -f spike-auth spike-storage spike-rest >/dev/null
