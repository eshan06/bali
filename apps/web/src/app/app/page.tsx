'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { ScrollText, UserPlus } from 'lucide-react';
import type { EventDTO, SessionDetailDTO } from '@bali/shared';
import { Arc } from '@/components/bali/Arc';
import { Button } from '@/components/bali/Button';
import { EventTimeline } from '@/components/bali/EventTimeline';
import { SummaryStrip } from '@/components/bali/StatusChip';
import { ICON_STROKE } from '@/components/bali/icons';
import { api } from '@/lib/api';
import { useCountdown, useSessionProgress } from '@/lib/live';
import { hhmm } from '@/lib/format';

interface TodayRow {
  kind: 'past' | 'now' | 'future';
  classId: string;
  sessionId?: string;
  name: string;
  timeLabel: string;
  subtitle: string;
  startLabel?: string;
  endsAtIso?: string;
  policyName?: string | null;
}

interface PortalHome {
  teacher: { displayName: string; schoolName: string };
  dateLabel: string;
  nextBell: string | null;
  live: SessionDetailDTO | null;
  today: TodayRow[];
  approvals: Array<{ membershipId: string; name: string; className: string }>;
  recent: EventDTO[];
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function LiveCard({ live }: { live: SessionDetailDTO }) {
  const countdown = useCountdown(live.session.endsAt);
  const pct = useSessionProgress(live.session.startedAt, live.session.endsAt);
  const waiting = live.participants.find((p) => p.state === 'emergency_unlocked');
  const passHolder = live.participants.find((p) => p.state === 'pass');

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-green-200 bg-surface-card p-[22px] shadow-1">
      <div className="flex items-center gap-3.5">
        <Arc size={46} stroke={5} pct={pct} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[18px] font-semibold leading-6">{live.session.className}</h2>
          <div className="mt-px text-[12.5px] leading-[17px] text-ink-secondary">
            Live · {live.session.policyName} — {live.session.allowedAppLabels.join(', ')} allowed
          </div>
        </div>
        <div className="ml-3 flex-none text-right">
          <div className="font-num text-[30px] font-semibold leading-[34px] tnum">{countdown}</div>
          <div className="text-[12px] leading-4 text-ink-secondary">ends {hhmm(live.session.endsAt)}</div>
        </div>
      </div>
      <SummaryStrip
        counts={live.counts}
        passLabel={
          passHolder?.passRemainingSeconds != null
            ? `Pass · ${Math.floor(passHolder.passRemainingSeconds / 60)}:${String(passHolder.passRemainingSeconds % 60).padStart(2, '0')}`
            : undefined
        }
      />
      <div className="flex items-center gap-2.5">
        <Link href={`/app/classes/${live.session.classId}/live`}>
          <Button>Open live grid</Button>
        </Link>
        <Link href={`/app/classes/${live.session.classId}/roster`}>
          <Button variant="secondary">Roster</Button>
        </Link>
        {waiting ? (
          <span className="ml-auto self-center text-[12.5px] leading-[17px] text-ink-tertiary">
            {waiting.shortName}&apos;s unlock is waiting in the grid
          </span>
        ) : null}
      </div>
    </section>
  );
}

export default function PortalHomePage() {
  const router = useRouter();
  const [home, setHome] = useState<PortalHome | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [entered, setEntered] = useState(false);

  const load = useCallback(() => {
    api
      .get<PortalHome>('/portal/home')
      .then(setHome)
      .catch(() => {});
  }, []);

  useEffect(load, [load]);
  useEffect(() => {
    const t = setTimeout(() => setEntered(true), 30);
    // snap-safe: force-finish after the longest stagger (design doc 06)
    const snap = setTimeout(() => setEntered(true), 1_050);
    const refresh = setInterval(load, 30_000);
    return () => {
      clearTimeout(t);
      clearTimeout(snap);
      clearInterval(refresh);
    };
  }, [load]);

  const startSession = async (row: TodayRow) => {
    if (!row.endsAtIso) return;
    setStartingId(row.classId);
    try {
      const detail = await api.post<SessionDetailDTO>(`/classes/${row.classId}/sessions`, {
        endsAt: row.endsAtIso,
      });
      router.push(`/app/classes/${detail.session.classId}/live`);
    } finally {
      setStartingId(null);
    }
  };

  const decide = async (membershipId: string, approve: boolean) => {
    await api.post(`/memberships/${membershipId}/${approve ? 'approve' : 'decline'}`);
    load();
  };

  if (!home) {
    return <div className="p-9 text-ink-tertiary">Loading…</div>;
  }

  return (
    <div className="mx-auto flex max-w-[1190px] flex-col gap-[22px] px-9 pb-12 pt-[30px]">
      <header className={clsx('fade-up', entered && 'in')}>
        <h1 className="text-[28px] font-semibold leading-[34px] tracking-[-0.015em]">
          {greeting()}, {home.teacher.displayName}
        </h1>
        <div className="mt-[3px] text-[13.5px] leading-[19px] text-ink-secondary">
          {home.dateLabel} · {home.teacher.schoolName}
          {home.nextBell ? ` · next bell ${home.nextBell}` : ''}
        </div>
      </header>

      <div className="grid grid-cols-[1fr_340px] items-start gap-5 max-[1024px]:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-5">
          {home.live ? (
            <div className={clsx('fade-up', entered && 'in')} style={{ transitionDelay: '60ms' }}>
              <LiveCard live={home.live} />
            </div>
          ) : null}

          <div className={clsx('fade-up', entered && 'in')} style={{ transitionDelay: '120ms' }}>
            <h3 className="mb-3 text-[11.5px] font-semibold uppercase leading-[15px] tracking-[0.05em] text-ink-tertiary">
              Today
            </h3>
            <div className="flex flex-col gap-2.5">
              {home.today.map((row) => (
                <div
                  key={row.classId}
                  className={clsx(
                    'flex items-center gap-3.5 rounded-md border bg-surface-card px-[18px] py-[15px]',
                    row.kind === 'now' ? 'border-green-200' : 'border-line',
                    row.kind === 'past' && 'opacity-55',
                  )}
                >
                  <span
                    className={clsx(
                      'w-[78px] flex-none font-num text-[13px] font-semibold leading-[17px] tnum',
                      row.kind === 'now' ? 'text-green-700' : 'text-ink-secondary',
                    )}
                  >
                    {row.timeLabel}
                  </span>
                  <span className="min-w-0 flex-1 pr-2">
                    <b className="block text-[15px] font-semibold leading-5 text-ink-primary">{row.name}</b>
                    <span className="block truncate text-[12.5px] leading-[17px] text-ink-tertiary">
                      {row.subtitle}
                    </span>
                  </span>
                  <span className="ml-auto flex-none">
                    {row.kind === 'now' ? (
                      <Link
                        href={`/app/classes/${row.classId}/live`}
                        className="text-[13px] font-semibold leading-[18px] text-ink-brand hover:underline"
                      >
                        Open
                      </Link>
                    ) : row.kind === 'future' ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={startingId === row.classId}
                        onClick={() => void startSession(row)}
                      >
                        Start at {row.timeLabel}
                      </Button>
                    ) : (
                      <span className="text-[12.5px] leading-[17px] text-ink-tertiary">Done</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-5">
          {home.approvals.length > 0 ? (
            <div
              className={clsx('fade-up rounded-md border border-line bg-surface-card p-[18px]', entered && 'in')}
              style={{ transitionDelay: '180ms' }}
            >
              <h3 className="mb-3.5 flex items-center gap-2 text-[11.5px] font-semibold uppercase leading-[15px] tracking-[0.05em] text-ink-tertiary">
                <UserPlus size={14} strokeWidth={ICON_STROKE} />
                Waiting to join
              </h3>
              {home.approvals.map((a, i) => (
                <div
                  key={a.membershipId}
                  className={clsx('flex items-center gap-2.5 py-[9px]', i > 0 && 'border-t border-line')}
                >
                  <span className="min-w-0 flex-1">
                    <b className="block text-[13.5px] font-semibold leading-[18px]">{a.name}</b>
                    <span className="block text-[11.5px] leading-[15px] text-ink-tertiary">
                      {a.className} · entered code today
                    </span>
                  </span>
                  <Button size="sm" className="px-3 py-[5px] text-[12.5px]" onClick={() => void decide(a.membershipId, true)}>
                    Approve
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="px-3 py-[5px] text-[12.5px]"
                    onClick={() => void decide(a.membershipId, false)}
                  >
                    Decline
                  </Button>
                </div>
              ))}
            </div>
          ) : null}

          <div
            className={clsx('fade-up rounded-md border border-line bg-surface-card p-[18px]', entered && 'in')}
            style={{ transitionDelay: '240ms' }}
          >
            <h3 className="mb-3.5 flex items-center gap-2 text-[11.5px] font-semibold uppercase leading-[15px] tracking-[0.05em] text-ink-tertiary">
              <ScrollText size={14} strokeWidth={ICON_STROKE} />
              Recent activity
            </h3>
            <EventTimeline events={home.recent} />
            <div className="mt-3.5">
              <Link href="/app/logs" className="text-[13px] font-semibold leading-[18px] text-ink-brand hover:underline">
                Open the full log
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
