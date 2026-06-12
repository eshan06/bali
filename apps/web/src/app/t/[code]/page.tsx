import type { Metadata } from 'next';
import { ArcMark } from '@/components/bali/ArcMark';
import { API_URL } from '@/lib/api';
import { OpenInBaliButton } from './open-button';

export const metadata: Metadata = { title: 'Bali — desk tag' };

/** W2 · public phone fallback: what a browser shows when a tag/QR resolves without
 *  the app. The ONLY data on it is the class display name (public route). */
export default async function TagFallbackPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const normalized = code.toUpperCase();

  let className: string | null = null;
  try {
    const res = await fetch(`${API_URL}/public/tags/${normalized}`, { cache: 'no-store' });
    if (res.ok) className = ((await res.json()) as { className: string }).className;
  } catch {
    /* API down — render the generic frame; the app path still works */
  }

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-[440px] flex-col items-center gap-[18px] px-7 pb-10 pt-16 text-center">
      <ArcMark size={52} />
      <h1 className="max-w-[280px] text-[24px] font-semibold leading-[30px]">
        This desk tag opens in Bali
      </h1>
      <p className="max-w-[280px] text-[15px] leading-[22px] text-ink-secondary">
        {className
          ? `${className} uses Bali for focus sessions. Get the app, then tap the tag again.`
          : 'This tag isn’t active right now. You can still join your class by code in the Bali app.'}
      </p>
      <span className="rounded-lg bg-surface-sunken px-3 py-1.5 font-mono text-[13px] font-medium leading-[18px] tracking-[0.12em] text-ink-tertiary">
        {normalized}
      </span>
      <span className="flex-1" />
      <OpenInBaliButton code={normalized} />
      <span
        aria-label="App Store badge placeholder"
        className="flex h-12 w-[152px] items-center justify-center rounded-[10px] border border-line font-mono text-[10px] font-medium leading-[14px] text-ink-tertiary [background:repeating-linear-gradient(45deg,var(--stone-100)_0_8px,var(--surface-card)_8px_16px)]"
      >
        app store badge
      </span>
    </main>
  );
}
