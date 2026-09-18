# Bali API — production image.
# The workspace packages export their TypeScript source directly (exports maps
# point at ./src), so the app runs under tsx at runtime rather than being
# compiled to dist. tsx is a production dependency for exactly this reason.
FROM node:22-slim AS base
WORKDIR /app
ENV NODE_ENV=production

# Install without devDependencies. The app runs its TypeScript source directly
# under tsx (a prod dependency), so the runtime needs nothing dev — this drops
# vitest, drizzle-kit, eslint/prettier/tsc and the rest of the tooling from the
# image. Verified both `npm run migrate` and the server boot on a --omit=dev
# install. (@electric-sql/pglite is NOT removed here: drizzle-orm pulls it as an
# optional peer dependency, which --omit=dev keeps. It is never imported at
# runtime; fully dropping it needs --omit=optional, left for a dedicated image
# pass since that also strips esbuild's platform binary and can't be Docker-
# tested here.) Copying the manifests first caches this layer across source-only
# changes.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci --omit=dev

# App source.
COPY . .

# The container binds the platform's port and 0.0.0.0.
EXPOSE 3001

# Apply migrations, then start the API. A single dev instance runs migrations on
# boot; a multi-instance deploy should move `npm run migrate` to a release phase
# so only one runner applies them.
CMD ["sh", "-c", "npm run migrate && npm start"]
