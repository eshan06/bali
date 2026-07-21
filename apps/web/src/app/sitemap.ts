import type { MetadataRoute } from 'next';

/** Public, crawlable pages only — never the token/identifier pages (/p, /t) or the
 *  authenticated portal (/app), which robots.ts also disallows. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  return ['/', '/privacy', '/terms', '/contact'].map((path) => ({
    url: `${base}${path}`,
    changeFrequency: 'monthly',
    priority: path === '/' ? 1 : 0.5,
  }));
}
