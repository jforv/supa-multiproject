# Build from the repo root: docker build -f apps/cp-api/Dockerfile -t cp-api .
FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install -g pnpm@11.13.1
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/cp-api/package.json apps/cp-api/

FROM base AS build
RUN pnpm install --frozen-lockfile
COPY apps/cp-api apps/cp-api
RUN pnpm --filter cp-api build

FROM base AS prod-deps
RUN pnpm install --prod --frozen-lockfile

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app/apps/cp-api
COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=prod-deps /app/apps/cp-api/node_modules ./node_modules
COPY --from=build /app/apps/cp-api/dist ./dist
COPY apps/cp-api/migrations ./migrations
COPY apps/cp-api/package.json ./
USER node
EXPOSE 8101
CMD ["node", "dist/server.js"]
