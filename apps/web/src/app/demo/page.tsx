import type { Metadata } from 'next';
import { Demo } from './Demo';

export const metadata: Metadata = {
  title: 'Product walkthrough',
  description:
    'One 50-minute period, end to end — the Bali student app, teacher app and live dashboard, with a working emergency exit you can try yourself.',
  alternates: { canonical: '/demo' },
};

/** Marketing walkthrough — a pinned device stage with scrolling narration.
 *  The interactive pieces live in ./Demo.tsx (client). */
export default function Page() {
  return <Demo />;
}
