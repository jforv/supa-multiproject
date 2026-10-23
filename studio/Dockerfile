# Stock Supabase Studio, built from a pinned upstream commit with platform mode on.
# No upstream files are edited: we fetch the commit, then build it with NEXT_PUBLIC_* baked in.
#
# Build (from the repo root):
#   docker build -f studio/Dockerfile \
#     --build-arg NEXT_PUBLIC_API_URL=http://host:8101 \
#     --build-arg NEXT_PUBLIC_GOTRUE_URL=http://host:8101/auth \
#     --build-arg NEXT_PUBLIC_SITE_URL=http://host:8082 -t cp-studio .
# NEXT_PUBLIC_* is compiled into the browser bundle: changing the public host means rebuilding.

ARG SUPABASE_SHA=d78685a364b338c68c8557e223fdf02e86a8a6a7

FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN apt-get update -qq && \
  apt-get install -y --no-install-recommends git python3 ca-certificates build-essential && \
  rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@11.13.1
WORKDIR /app

FROM base AS src
ARG SUPABASE_SHA
RUN git init -q . && \
  git remote add origin https://github.com/supabase/supabase.git && \
  git fetch -q --depth 1 origin "${SUPABASE_SHA}" && \
  git checkout -q FETCH_HEAD

FROM src AS turbo
RUN pnpm dlx turbo@2.9.14 prune studio --docker

FROM base AS deps
COPY --from=turbo /app/out/json ./
COPY --from=turbo /app/out/pnpm-lock.yaml ./
COPY --from=src /app/patches ./patches
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY --from=turbo /app/out/full ./
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_GOTRUE_URL
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_IS_PLATFORM=true \
  NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
  NEXT_PUBLIC_GOTRUE_URL=${NEXT_PUBLIC_GOTRUE_URL} \
  NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL} \
  SKIP_ASSET_UPLOAD=1 \
  NODE_OPTIONS=--max-old-space-size=8192
RUN pnpm --filter studio exec next build
RUN mkdir -p /srv && \
  cp -a apps/studio/.next/standalone/. /srv/ && \
  mkdir -p /srv/apps/studio/.next && \
  cp -a apps/studio/.next/static /srv/apps/studio/.next/static && \
  cp -a apps/studio/public /srv/apps/studio/public

FROM node:22-slim AS production
WORKDIR /app
COPY --from=build /srv ./
# PLATFORM_PG_META_URL and PG_META_CRYPTO_KEY are read at runtime (see deploy/compose.yml).
ENV PORT=3000 HOSTNAME=0.0.0.0 NODE_ENV=production
EXPOSE 3000
USER node
CMD ["node", "apps/studio/server.js"]
