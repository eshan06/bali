---
description: Final verification loop before pushing — run everything, fix, repeat until fully clean
---

Run the full verification loop on the current work. Do not stop at the first
failure and do not declare done until one complete pass is clean:

1. `npm run typecheck && npm run lint && npm run format:check && npm test`
2. If the change touches API behavior, also run `npm run demo` (end-to-end in
   memory) and confirm it exits clean.
3. Re-read the entire diff (`git diff main...HEAD`) adversarially, as the
   blocking reviewer will: any code change without a test? any write to
   `participations`/`events` outside `packages/db/src/transitions.ts`? any
   renamed or removed shipped `/v1` field or `packages/shared` vocab value? any
   silent failure path? any secret? `docs/PLAN.md` updated?
4. Fix everything found, then rerun from step 1. Repeat until a full pass has
   zero failures and zero findings.
5. Report: what passed, what was fixed along the way, and anything you chose
   not to fix with the reason.
