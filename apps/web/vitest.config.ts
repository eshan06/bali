import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Next compiles the portal's JSX itself, so tsconfig keeps it as written (`jsx: preserve`), which
// vitest can't run; React's automatic runtime here lets a test render a component
// (field.test.ts). It changes nothing Next builds. `@/` is tsconfig's path to src/, so a test can
// render a component that imports through it (live-grid.test.ts).
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    alias: [{ find: /^@\//, replacement: fileURLToPath(new URL('./src/', import.meta.url)) }],
  },
});
