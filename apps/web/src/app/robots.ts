import type { MetadataRoute } from 'next';

/** Allow the marketing + auth surfaces; keep the token/identifier-bearing public pages
 *  (/p parent views, /t desk-tag landings) and the authenticated portal out of crawls. */
export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '');
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/p/', '/t/', '/app/', '/auth/'],
    },
    ...(base ? { sitemap: `${base}/sitemap.xml`, host: base } : {}),
  };
}
