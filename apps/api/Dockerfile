# Bali API image. Build context is the REPO ROOT (the API imports the @bali/db and
# @bali/shared workspace packages as TypeScript source, run through tsx at runtime).
#   docker build -f apps/api/Dockerfile -t bali-api .

FROM node:20-slim AS deps
WORKDIR /app
ENV NODE_ENV=production
# Manifests first for layer caching. Workspace installs need every package.json.
COPY package.json package-lock.json ./
COPY packages/db/package.json ./packages/db/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY apps/api/package.json ./apps/api/package.json
# Prod deps only (tsx is a runtime dep here; pino-pretty/tsc/vitest are dev-only).
RUN npm ci --omit=dev

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps/api ./apps/api
# Run as the unprivileged user node:20-slim ships with.
USER node
EXPOSE 3001
# exec-form so node is PID 1 and receives SIGTERM directly (graceful shutdown in index.ts).
# `--import tsx` transpiles the TS workspace sources on the fly.
CMD ["node", "--import", "tsx", "apps/api/src/index.ts"]
