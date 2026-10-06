import { defineConfig } from 'vitest/config';

// Next compiles the portal's JSX itself, so tsconfig keeps it as written (`jsx: preserve`), which
// vitest can't run; React's automatic runtime here lets a test render a component
// (field.test.ts). It changes nothing Next builds.
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
});
