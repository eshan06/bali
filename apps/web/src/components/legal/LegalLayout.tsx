import Link from 'next/link';
import { ArcMark } from '@/components/bali/ArcMark';

/** Shared chrome for the public legal/info pages (privacy, terms, contact). Calm,
 *  readable column in the product's voice; no app shell, no auth. */
export function LegalLayout({
  title,
  updated,
  children,
}: {
  title: string;
  updated?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-[720px] flex-col gap-8 px-6 pb-20 pt-12">
      <header className="flex flex-col gap-4 border-b border-line pb-6">
        <Link href="/" className="flex w-fit items-center gap-2 text-[16px] font-semibold leading-[22px]">
          <ArcMark size={20} />
          Bali
        </Link>
        <div>
          <h1 className="text-[30px] font-semibold leading-[36px] tracking-[-0.015em]">{title}</h1>
          {updated ? (
            <p className="mt-1.5 text-[13px] leading-[18px] text-ink-tertiary">Last updated {updated}</p>
          ) : null}
        </div>
      </header>
      <article className="legal-prose flex flex-col gap-5 text-[15px] leading-[24px] text-ink-secondary">
        {children}
      </article>
      <footer className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-line pt-6 text-[13px] leading-[18px] text-ink-tertiary">
        <Link href="/" className="hover:text-ink-secondary">
          Home
        </Link>
        <Link href="/privacy" className="hover:text-ink-secondary">
          Privacy
        </Link>
        <Link href="/terms" className="hover:text-ink-secondary">
          Terms
        </Link>
        <Link href="/contact" className="hover:text-ink-secondary">
          Contact
        </Link>
      </footer>
    </main>
  );
}

/** Section heading inside a legal page. */
export function LegalSection({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="text-[18px] font-semibold leading-[24px] text-ink-primary">{heading}</h2>
      {children}
    </section>
  );
}
