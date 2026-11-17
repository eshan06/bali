'use client';

import { type ReactNode, useEffect, useState } from 'react';

import { bellTime } from '@/lib/session-controls';

/** "23:14", "1:05:00": the time left in whole seconds, rounded up, so the bell itself reads 0:00. */
export function timeLeft(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const [h, m] = [Math.floor(s / 3600), Math.floor((s % 3600) / 60)];
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** The share of the session still to run, 0 to 1: the ring's arc. */
export function shareLeft(startedAt: string, endsAt: string, now: number): number {
  const end = Date.parse(endsAt);
  const length = end - Date.parse(startedAt);
  return length > 0 ? Math.min(1, Math.max(0, (end - now) / length)) : 0;
}

/**
 * When to read the clock again, `left` ms before the bell: just after the time left's next whole
 * second (the bell's own milliseconds, so no second is ever skipped or shown twice); null once the
 * bell is past, when the countdown rests at 0:00.
 */
export function nextTick(left: number): number | null {
  return left > 0 ? (left % 1000) + 10 : null;
}

/** This computer's clock, read as a bell arrives or moves, then as each second turns over. */
export function useClock(endsAt: string | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endsAt === null) return;
    const end = Date.parse(endsAt);
    let timer: number | undefined;
    const tick = () => {
      const at = Date.now();
      setNow(at);
      const wait = nextTick(end - at);
      if (wait !== null) timer = window.setTimeout(tick, wait);
    };
    // Right away, so a bell that lands late (a reload's snapshot, an extend) never counts from an
    // older reading.
    timer = window.setTimeout(tick, 0);
    return () => window.clearTimeout(timer);
  }, [endsAt]);
  return now;
}

/**
 * The session's ring: the time left as a green arc from the top, on its track. The student's live
 * card and their home with no class 46 px, r 20.5, stroked 5 (StudentHome, StudentHomeEmpty). A
 * class's page in the lock-only look draws it 48 px, scaled to 44 on a phone (`className`;
 * ClassLive, PhoneLive), and Present 84 px, stroked 10 (LO9; Present).
 */
export function Ring({
  share,
  box,
  stroke,
  className = '',
}: {
  share: number;
  box: number;
  stroke: number;
  className?: string;
}) {
  const c = box / 2;
  const r = c - stroke / 2;
  const around = 2 * Math.PI * r;
  return (
    <svg
      width={box}
      height={box}
      viewBox={`0 0 ${box} ${box}`}
      aria-hidden="true"
      className={`shrink-0 ${className}`.trim()}
    >
      <circle cx={c} cy={c} r={r} fill="none" strokeWidth={stroke} className="stroke-arc-track" />
      {share > 0 ? (
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(share * around).toFixed(1)} ${around.toFixed(1)}`}
          transform={`rotate(-90 ${c} ${c})`}
          className="stroke-arc-fill"
        />
      ) : null}
    </svg>
  );
}

/**
 * A live card (v2.css's `.livecard`; StudentHome's, W3, and Home's, Main, PV17b): the live edge, 16 px
 * corners, 22 px in, its parts 16 px apart.
 */
export const LIVE_CARD =
  'flex flex-col gap-4 rounded-live border border-live-edge bg-surface-card p-5.5 shadow-1';

/**
 * A live card's head (`.lc-head`; StudentHome's, W3, and Home's, Main, PV17b): the 46 px ring, the
 * share of the session left, its track alone until the session's start is known; the name over its
 * line; the time left on this computer's clock (`now`) to the server's bell, the bell under it. Home's
 * card says its name alone while its session is read or didn't load (HomeMoreStates).
 */
export function LiveCardHead({
  id,
  name,
  line = null,
  startedAt = null,
  endsAt = null,
  now,
}: {
  id: string;
  name: string;
  line?: string | null;
  startedAt?: string | null;
  endsAt?: string | null;
  now: number;
}) {
  return (
    <div className="flex items-center gap-3.5">
      <Ring
        share={startedAt && endsAt ? shareLeft(startedAt, endsAt, now) : 0}
        box={46}
        stroke={5}
      />
      <div className="min-w-0 flex-1">
        <h2 id={id} className="text-h3 wrap-anywhere">
          {name}
        </h2>
        {line === null ? null : (
          <p className="text-countdown-sub text-text-secondary wrap-anywhere">{line}</p>
        )}
      </div>
      {endsAt === null ? null : (
        <p className="flex shrink-0 flex-col text-right">
          <span className="font-num text-home-countdown tabular-nums">
            {timeLeft(Date.parse(endsAt) - now)}
          </span>
          <span className="text-cell-sub text-text-secondary">
            ends <time dateTime={endsAt}>{bellTime(endsAt)}</time>
          </span>
        </p>
      )}
    </div>
  );
}

/**
 * The time left to the server's bell on this computer's clock (`now`), the bell's time under it,
 * after a hairline (StudentLesson's, W4); "…" until the bell is known; on a phone at the header's
 * right, with no hairline.
 */
export function Countdown({ endsAt, now }: { endsAt: string | null; now: number }) {
  return (
    <p className="flex flex-col border-l border-border-default pl-4.5 max-sm:border-l-0 max-sm:pl-0 max-sm:text-right">
      {endsAt ? (
        <>
          <span className="font-num text-data-lg tabular-nums">
            {timeLeft(Date.parse(endsAt) - now)}
          </span>
          <span className="text-countdown-sub text-text-secondary">
            ends <time dateTime={endsAt}>{bellTime(endsAt)}</time>
          </span>
        </>
      ) : (
        <>
          <span className="font-num text-data-lg text-text-tertiary">…</span>
          <span className="text-countdown-sub">{'\u00a0'}</span>
        </>
      )}
    </p>
  );
}

/**
 * A class's header while a session runs, in the lock-only look (LO5; ClassLive, PhoneLive): the
 * ring, the name over when it ends and the join code, then the time left on this computer's clock
 * to the server's bell over "left", and the controls (`children`). Until the bell is known the clock
 * says … and "Ends" waits (LiveTopStates). On a phone, under 760 px, the ring 44 px and the name
 * one size down, the clock and the controls on a line of their own, the clock at its start.
 */
export function LiveHead({
  name,
  joinCode,
  startedAt,
  endsAt,
  children,
}: {
  name: string;
  joinCode: string;
  startedAt: string | null;
  endsAt: string | null;
  children: ReactNode;
}) {
  const now = useClock(endsAt);
  const share = startedAt && endsAt ? shareLeft(startedAt, endsAt, now) : 0;
  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-4">
      <div className="flex min-w-0 flex-[1_1_300px] items-center gap-4">
        <Ring share={share} box={48} stroke={5} className="max-[760px]:size-11" />
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-page-title text-balance wrap-anywhere max-[760px]:text-page-title-phone">
            {name}
          </h1>
          <p className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-meta text-text-secondary">
            {endsAt ? (
              <span>
                Ends <time dateTime={endsAt}>{bellTime(endsAt)}</time>
              </span>
            ) : null}
            <span>
              Join code{' '}
              <span translate="no" className="font-mono font-medium text-text-primary">
                {joinCode}
              </span>
            </span>
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 max-[760px]:w-full max-[760px]:justify-between">
        <p className="flex flex-col items-end max-[760px]:items-start">
          {endsAt ? (
            <span className="text-home-countdown tabular-nums">
              {timeLeft(Date.parse(endsAt) - now)}
            </span>
          ) : (
            <span className="text-home-countdown text-text-tertiary">…</span>
          )}
          <span className="text-countdown-sub text-text-tertiary">left</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      </div>
    </header>
  );
}

/**
 * Present's time (LO9; Present, PresentStates): the session's ring, 84 px, beside the time left to
 * the server's bell on this computer's clock, over "left, until 9:55 AM"; until the bell is known,
 * the ring's track alone and … over "left".
 */
export function PresentClock({
  startedAt,
  endsAt,
}: {
  startedAt: string | null;
  endsAt: string | null;
}) {
  const now = useClock(endsAt);
  const share = startedAt && endsAt ? shareLeft(startedAt, endsAt, now) : 0;
  return (
    <div className="flex items-center gap-5">
      <Ring share={share} box={84} stroke={10} />
      <p className="flex flex-col gap-2">
        {endsAt ? (
          <span className="text-present-clock tabular-nums">
            {timeLeft(Date.parse(endsAt) - now)}
          </span>
        ) : (
          <span className="text-present-clock text-text-tertiary">…</span>
        )}
        <span className="text-present-until text-text-secondary">
          left
          {endsAt ? (
            <>
              , until <time dateTime={endsAt}>{bellTime(endsAt)}</time>
            </>
          ) : null}
        </span>
      </p>
    </div>
  );
}
