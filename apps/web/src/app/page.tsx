import Link from 'next/link';
import { ArcMark } from '@/components/bali/ArcMark';

/**
 * Marketing landing — full §05 build lands in Phase 2b. Until then the route exists,
 * carries the brand, and routes teachers to the door.
 */
export default function Landing() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 px-8 text-center">
      <ArcMark size={40} />
      <h1 className="max-w-xl text-[40px] font-semibold leading-[46px] tracking-[-0.02em]">
        Fifty focused minutes. <em className="not-italic text-green-700">One tap.</em>
      </h1>
      <p className="max-w-md text-[17px] leading-[27px] text-ink-secondary">
        Students tap a desk tag and their distractions rest until the bell. Teachers see one calm
        grid. And the emergency exit is always one hold away — no questions asked.
      </p>
      <Link
        href="/login"
        className="rounded-md bg-green-700 px-6 py-3 text-[16px] font-semibold text-white hover:bg-green-800"
      >
        Sign in
      </Link>
      <p className="text-[13.5px] text-ink-tertiary">Built on Apple Screen Time · Students always hold the exit</p>
    </main>
  );
}
