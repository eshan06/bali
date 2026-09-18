# Bali API — production image.
# The workspace packages export their TypeScript source directly (exports maps
# point at ./src), so the app runs under tsx at runtime rather than being
# compiled to dist. tsx is a production dependency for exactly this reason.
FROM node:22-slim AS base
WORKDIR /app
ENV NODE_ENV=production

# Install only production dependencies from the lockfile. The app runs its
# TypeScript source directly under tsx (a prod dependency), so the image needs
# nothing from devDependencies — --omit=dev keeps pglite, vitest, drizzle-kit
# and the rest of the test/build tooling out of the deployed image. (Verified:
# the server boots on prod-only deps.) Copying the manifests first keeps this
# layer cached across source-only changes.
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
