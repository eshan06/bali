import type { Config } from 'tailwindcss';
// Canonical app copy of design_handoff_bali_2/tokens/tailwind.tokens.js — the design
// bundle remains the source of truth; update both together.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { baliTokens } = require('./src/styles/bali-tokens.cjs');

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      ...baliTokens,
      // next/font registers hashed family names; route through its CSS variables.
      fontFamily: {
        sans: ['var(--font-instrument)', 'system-ui', 'sans-serif'],
        num: ['ui-rounded', '"SF Pro Rounded"', 'var(--font-instrument)', 'sans-serif'],
        mono: ['var(--font-jbmono)', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
