import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/*
 * The CSP's nonce reaches a page only if the page renders per request (src/middleware.ts): one
 * built ahead carries no nonce, so under 'strict-dynamic' its scripts are refused and the page
 * is blank, while the build and every other test stay green. CI's build step also fails on a
 * static (○) route.
 */
const APP = fileURLToPath(new URL('.', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(entry.name) && !entry.name.includes('.test.') ? [path] : [];
  });
}

describe('every portal page renders per request, so it carries the CSP nonce', () => {
  it('the root layout forces dynamic rendering', () => {
    const layout = readFileSync(join(APP, 'layout.tsx'), 'utf8');
    expect(layout).toMatch(/^export const dynamic = 'force-dynamic';$/m);
  });

  it('no segment overrides it with its own dynamic, revalidate or static params', () => {
    const overrides = sources(APP)
      .filter((file) => !file.endsWith(join(APP, 'layout.tsx')))
      .filter((file) =>
        /export\s+(const\s+(dynamic|revalidate)\b|(async\s+)?function\s+generateStaticParams\b)/.test(
          readFileSync(file, 'utf8'),
        ),
      );
    expect(overrides).toEqual([]);
  });
});
