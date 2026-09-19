# Contributing to Bali

## Setup

```bash
git clone https://github.com/eshan06/bali && cd bali
nvm use          # Node 22, pinned by .nvmrc
npm ci
npm test         # no database server needed (in-process Postgres)
npm run dev:api  # then: curl localhost:3001/healthz
```

## The loop

1. Branch off `main`: `git checkout -b yourname/what-youre-doing`.
2. Make the change **with tests**. `CLAUDE.md` lists the rules CI enforces —
   read it once; it's short.
3. Push and open a PR. Keep PRs small: one thing per PR.
4. All checks must be green: the two test lanes, **Claude Review** (an AI
   reviews your diff against this repo's rules and blocks on violations), and
   **Plan doc updated** (source changes must also update `docs/PLAN.md`, or a
   commit message may carry `[no-plan]` for trivial fixes).
5. Claude Review red? Read its comment, fix, push. Or comment
   `@claude fix the review findings` on the PR and it pushes the fix for you.
6. Green = merge. Nobody can push to `main` directly, including the owner.

## Things that will bounce your PR

- A code change with no tests.
- Writing `participations`/`events` anywhere outside
  `packages/db/src/transitions.ts`.
- Renaming or removing anything shipped: `/v1` fields/endpoints or the vocab
  lists in `packages/shared`.
- Secrets in the diff — `.env` never leaves your machine.
