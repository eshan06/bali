// @ts-check
import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/', '**/dist/', '**/coverage/', '**/.next/', '**/next-env.d.ts'] },
  { ignores: ['**/.build/'] }, // SwiftPM's: dependencies' checkouts, GRDB's JavaScript too
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // Plain Node.js scripts outside the TypeScript workspaces (the Cognito Lambda).
    files: ['infra/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', structuredClone: 'readonly' },
    },
  },
  prettier,
);
