import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Bali — Focus sessions for your classroom',
    short_name: 'Bali',
    description:
      'Students tap a desk tag and their distractions rest until the bell. Teachers see one calm grid.',
    start_url: '/app',
    display: 'standalone',
    background_color: '#F7F5F2',
    theme_color: '#245A43',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
