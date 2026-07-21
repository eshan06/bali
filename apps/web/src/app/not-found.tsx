import Link from 'next/link';
import { ArcMark } from '@/components/bali/ArcMark';

/** Branded 404 for any unknown public URL (the /app subtree has its own error.tsx). */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-[440px] flex-col items-center justify-center gap-[18px] px-7 pb-16 text-center">
      <ArcMark size={52} />
      <h1 className="text-[24px] font-semibold leading-[30px]">This page isn’t here</h1>
      <p className="max-w-[320px] text-[15px] leading-[22px] text-ink-secondary">
        The link may be old or mistyped. Everything else is right where you left it.
      </p>
      <Link
        href="/"
        className="rounded-sm bg-green-700 px-5 py-2.5 text-[15px] font-semibold text-white hover:bg-green-800"
      >
        Back to home
      </Link>
    </main>
  );
}
