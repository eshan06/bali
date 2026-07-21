import type { Metadata } from 'next';
import { ArcMark } from '@/components/bali/ArcMark';
import { API_URL } from '@/lib/api';
import { OpenInBaliButton } from './open-button';

// Per-class desk-tag landing keyed by a printed code — keep it out of search results.
export const metadata: Metadata = {
  title: 'Bali — desk tag',
  robots: { index: false, follow: false },
};

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

  // Set NEXT_PUBLIC_APP_STORE_URL once the iOS app is published; until then we tell the
  // truth instead of showing a dead placeholder badge.
  const appStoreUrl = process.env.NEXT_PUBLIC_APP_STORE_URL;

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-[440px] flex-col items-center gap-[18px] px-7 pb-10 pt-16 text-center">
      <ArcMark size={52} />
      <h1 className="max-w-[280px] text-[24px] font-semibold leading-[30px]">
        This desk tag opens in Bali
      </h1>
      <p className="max-w-[280px] text-[15px] leading-[22px] text-ink-secondary">
        {className
          ? `${className} uses Bali for focus sessions. Open the app and tap the tag again.`
          : 'This tag isn’t active right now. You can still join your class by code in the Bali app.'}
      </p>
      <span className="rounded-lg bg-surface-sunken px-3 py-1.5 font-mono text-[13px] font-medium leading-[18px] tracking-[0.12em] text-ink-tertiary">
        {normalized}
      </span>
      <span className="flex-1" />
      <OpenInBaliButton code={normalized} />
      <div className="text-[13px] leading-[19px] text-ink-tertiary">
        Don’t have Bali yet?{' '}
        {appStoreUrl ? (
          <a
            href={appStoreUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-ink-brand underline underline-offset-2"
          >
            Get it on the App Store
          </a>
        ) : (
          <span>It’s coming to the App Store soon — ask your teacher for early access.</span>
        )}
      </div>
    </main>
  );
}
