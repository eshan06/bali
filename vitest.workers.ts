import { availableParallelism } from 'node:os';

// How many test files each package's vitest runs at once: the count `vitest run` picks on its own,
// a worker per logical core but one, up to 6. At its 15 on the 16-thread Windows PC the heaviest
// files ran short of CPU and memory and failed where they pass alone: the boot test's server start,
// slides.test.ts's databases, the icon-stroke check's type checker (docs/DECISIONS.md, 2026-10-15).
// A machine of 7 logical cores or fewer keeps that count, CI's runners among them, and
// VITEST_MAX_WORKERS still wins over this: CI's unit lane sets it to a worker per core.
export const maxWorkers = Math.max(1, Math.min(availableParallelism() - 1, 6));
