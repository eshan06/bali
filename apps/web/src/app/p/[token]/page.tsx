import type { Metadata } from 'next';
import type { ParentViewDTO } from '@bali/shared';
import { ArcMark } from '@/components/bali/ArcMark';
import { StatusChip } from '@/components/bali/StatusChip';
import { API_URL } from '@/lib/api';

// Renders per-student info behind an unguessable token — never index, never follow.
export const metadata: Metadata = {
  title: 'Bali — focus summary',
  robots: { index: false, follow: false },
};

/** Read-only parent view. The long random token in the URL is the only credential —
 *  no login. Status only: this page never shows screen content, apps, or location.
 *  Fed by the public `/v1/public/parent/:token` endpoint (event-stream reports). */
export default async function ParentViewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let view: ParentViewDTO | null = null;
  try {
    const res = await fetch(`${API_URL}/public/parent/${token}`, { cache: 'no-store' });
    if (res.ok) {
      const data = (await res.json()) as ParentViewDTO;
      // Guard against version skew / partial responses on this public no-login surface:
      // a malformed 200 should show the calm inactive frame, never an unstyled crash.
      if (data?.summary && data?.history && Array.isArray(data.history.rows) && data.studentShortName) {
        view = data;
      }
    }
  } catch {
    /* API down — fall through to the inactive-link frame */
  }

  if (!view) {
    return (
      <main className="mx-auto flex min-h-[100dvh] max-w-[440px] flex-col items-center gap-[18px] px-7 pb-10 pt-20 text-center">
        <ArcMark size={52} />
        <h1 className="max-w-[300px] text-[24px] font-semibold leading-[30px]">This link isn’t active</h1>
        <p className="max-w-[300px] text-[15px] leading-[22px] text-ink-secondary">
          The teacher may have turned it off, or it was replaced by a newer link. Ask your child’s teacher for an
          up-to-date link.
        </p>
      </main>
    );
  }

  const { summary } = view;

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-[520px] flex-col gap-5 px-6 pb-14 pt-12">
      {/* Header */}
      <header className="flex flex-col items-center gap-2.5 text-center">
        <ArcMark size={44} />
        <h1 className="text-[24px] font-semibold leading-[30px] tracking-[-0.01em]">
          {view.studentShortName} · {view.className}
        </h1>
        <p className="text-[14px] leading-[19px] text-ink-secondary">
          {view.teacherName}
          {view.schoolName ? ` · ${view.schoolName}` : ''}
        </p>
        <p className="text-[12.5px] leading-[17px] text-ink-tertiary">{view.generatedAtLabel}</p>
      </header>

      {/* Cold-open framing — a parent may open this with no prior context. Say plainly
          what Bali is, who shared it, and that it's read-only & status-only. */}
      <p className="rounded-md border border-line bg-surface-card px-4 py-3 text-center text-[13px] leading-[19px] text-ink-secondary">
        {view.teacherName} shared this read-only focus summary with you — no account needed. Bali is a
        classroom focus tool; this page shows only focus status, never screens, apps, messages, or
        location.
      </p>

      {/* Live-right-now banner (only while a session is open) */}
      {view.live ? (
        <div className="flex items-center justify-center gap-3 rounded-md border border-line bg-surface-card px-4 py-3">
          <span className="text-[12px] font-semibold uppercase tracking-[0.05em] text-ink-tertiary">In class now</span>
          <StatusChip state={view.live.state} size="mini" label={view.live.label} />
        </div>
      ) : null}

      {/* At-a-glance summary */}
      <section className="grid grid-cols-3 gap-3">
        <SummaryStat value={summary.sessionsShown} label={summary.sessionsShown === 1 ? 'session' : 'sessions'} />
        <SummaryStat value={summary.focusedSessions} label="ended focused" />
        <SummaryStat
          value={summary.totalUnlocks}
          label={summary.totalUnlocks === 1 ? 'emergency unlock' : 'emergency unlocks'}
        />
      </section>

      {/* Recent sessions */}
      <section className="overflow-hidden rounded-md border border-line bg-surface-card">
        <div className="border-b border-line bg-surface-sunken px-4 py-2.5 text-[11.5px] font-semibold uppercase leading-[15px] tracking-[0.05em] text-ink-tertiary">
          Recent sessions
        </div>
        {view.history.rows.length === 0 ? (
          <div className="px-4 py-6 text-center text-[13.5px] leading-[19px] text-ink-tertiary">
            No completed sessions yet. Focus summaries appear here after class meets.
          </div>
        ) : (
          view.history.rows.map((row) => (
            <div key={row.sessionId} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0">
              <span className="w-9 flex-none text-[13px] font-semibold leading-[18px] text-ink-tertiary">
                {row.dayLabel}
              </span>
              <StatusChip state={row.state} size="mini" />
              <span className="min-w-0 flex-1 text-[13.5px] leading-[19px] text-ink-secondary">{row.label}</span>
            </div>
          ))
        )}
      </section>

      {/* Privacy boundary + framing — the honest contract */}
      <footer className="flex flex-col gap-2 px-1 pt-1 text-center">
        <p className="text-[12.5px] leading-[18px] text-ink-tertiary">{view.history.boundary}</p>
        <p className="text-[12.5px] leading-[18px] text-ink-tertiary">{view.history.framing}</p>
        <p className="text-[12.5px] leading-[18px] text-ink-tertiary">
          Questions? Reach out to {view.teacherName}
          {view.schoolName ? ` at ${view.schoolName}` : ''}. ·{' '}
          <a href="/privacy" className="underline underline-offset-2 hover:text-ink-secondary">
            Privacy
          </a>
        </p>
      </footer>
    </main>
  );
}

function SummaryStat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-md border border-line bg-surface-card px-3 py-4 text-center">
      <span className="text-[28px] font-semibold leading-[32px] tnum">{value}</span>
      <span className="text-[11.5px] leading-[15px] text-ink-tertiary">{label}</span>
    </div>
  );
}
