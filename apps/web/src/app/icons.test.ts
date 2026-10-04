import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/*
 * The portal's icon is the app's (concept A, the mark on its stone tile). It is served from
 * public/ and named in the root layout's metadata: an app/icon.* or app/apple-icon.* file would
 * build as a static route, which carries no CSP nonce and fails CI's every-route-dynamic check.
 */
const APP = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = fileURLToPath(new URL('../../public/', import.meta.url));

describe('the portal icon', () => {
  it('every icon the root layout names is a file in public/', () => {
    const layout = readFileSync(join(APP, 'layout.tsx'), 'utf8');
    const urls = [...layout.matchAll(/url: '\/([^']+)'/g)].map((match) => match[1]);
    expect(urls).toEqual(['icon.svg', 'icon.png', 'apple-icon.png']);
    for (const url of urls) expect(existsSync(join(PUBLIC, url)), url).toBe(true);
  });

  it('no metadata icon file sits in app/, where it would build as a static route', () => {
    const iconFiles = readdirSync(APP).filter((name) => /^(icon|apple-icon|favicon)\b/.test(name));
    expect(iconFiles).toEqual([]);
  });
});
