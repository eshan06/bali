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
# runtime; fully dropping it needs --omit=optional, which also removes esbuild's
# platform binary — esbuild re-fetches that in a postinstall, but the fetch is
# network-dependent and can't be validated in the image build here, so it is
# left for a dedicated image pass.) Copying the manifests first caches this
# layer across source-only changes.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
# apps/web is a workspace in the lockfile, so its manifest must be present for
# `npm ci` to reproduce the tree — even though the portal is not served by this
# image. Omitting it leaves npm resolving a workspace with no directory on disk.
COPY apps/web/package.json apps/web/package.json
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
# The shell runs the `&&`; `exec` then replaces it with the server's own node
# process, so the API is PID 1 and receives Railway's SIGTERM (sh as PID 1 ignores
# it, and a restart then SIGKILLs the API mid-request). `node --import tsx` is what
# `npm start` runs (`tsx src/server.ts`) with no npm or tsx wrapper process between
# the signal and the server, from apps/api as `npm start -w` would. This CMD is
# the only start command: Railway's is never set.
CMD ["sh", "-c", "npm run migrate && cd apps/api && exec node --import tsx src/server.ts"]
