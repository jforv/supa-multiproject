#!/usr/bin/env bash
# Generates deploy/.env with fresh secrets. Usage: ./init-env.sh <public-host> <admin-email>
# <public-host> is what browsers use to reach this machine (LAN IP or DNS name); it is baked into Studio.
set -euo pipefail
cd "$(dirname "$0")"

if [ $# -ne 2 ]; then
  echo "usage: $0 <public-host> <admin-email>" >&2
  exit 2
fi
if [ -e .env ]; then
  echo ".env already exists; refusing to overwrite (delete it to regenerate)" >&2
  exit 1
fi

umask 077
cat > .env <<EOF
PUBLIC_HOST=$1
STUDIO_PORT=8082
CP_PORT=8101
POSTGRES_PASSWORD=$(openssl rand -hex 16)
PG_META_CRYPTO_KEY=$(openssl rand -hex 16)
CP_MASTER_KEY=$(openssl rand -base64 32)
CP_JWT_SECRET=$(openssl rand -hex 32)
CP_BOOTSTRAP_ADMIN_EMAIL=$2
CP_BOOTSTRAP_ADMIN_PASSWORD=$(openssl rand -hex 12)
EOF
echo "Wrote deploy/.env (mode 600). Admin login: $2 / see CP_BOOTSTRAP_ADMIN_PASSWORD in .env"
