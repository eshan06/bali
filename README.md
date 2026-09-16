# Bali

Tap a block, the phone locks into focus. This is the v3 rebuild; the design doc is
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Layout

| Workspace         | What it is                                            |
| ----------------- | ----------------------------------------------------- |
| `apps/api`        | The Fastify HTTP API                                  |
| `packages/db`     | Drizzle schema + migrations (lands in Phase 1 step 2) |
| `packages/shared` | Types and constants shared by server and clients      |

## From zero

Requires Node 22 — `.nvmrc` pins it, `nvm use` picks it up.

```bash
npm ci
npm run typecheck && npm run lint && npm test
npm run dev:api        # then: curl localhost:3001/healthz
```

Configuration comes from a single `.env` at the repo root. Every variable the API reads
is declared and validated in `apps/api/src/env.ts`; a missing or malformed value fails
the boot with a readable list instead of a crash somewhere downstream.
