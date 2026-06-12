'use client';

import { Button } from '@/components/bali/Button';

/** Deep link first; the store badge below is the fallback's fallback. */
export function OpenInBaliButton({ code }: { code: string }) {
  return (
    <Button size="lg" onClick={() => (window.location.href = `bali://t/${code}`)}>
      Open in Bali
    </Button>
  );
}
