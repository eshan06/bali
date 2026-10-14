'use client';

import { type ReactNode, useEffect, useState } from 'react';

import { bellTime } from '@/lib/session-controls';

import { CHIP, COUNTED, type StateCounts } from './live-grid';

/** The ring's circle (ClassLive): r 19.5 in a 44 px box, stroked 5. */
const R = 19.5;
const AROUND = 2 * Math.PI * R;

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
function useClock(endsAt: string | null): number {
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

/** The session's ring (ClassLive): the time left as a green arc from the top, on its track. */
function Ring({ share }: { share: number }) {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true" className="shrink-0">
      <circle cx="22" cy="22" r={R} fill="none" strokeWidth="5" className="stroke-arc-track" />
      {share > 0 ? (
        <circle
          cx="22"
          cy="22"
          r={R}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${(share * AROUND).toFixed(1)} ${AROUND.toFixed(1)}`}
          transform="rotate(-90 22 22)"
          className="stroke-arc-fill"
        />
      ) : null}
    </svg>
  );
}

/**
 * A class's header while a session runs (PV7; ClassLive): the ring, the name over "Live · 25 of 28
 * joined · join code VMAF7E", the countdown to the server's bell on this computer's clock with the
 * bell's time under it, then the controls (`children`) at the end. Until the grid is counted the
 * line says "Live" and the code; until the bell is known the countdown says "…". On a phone, as
 * PhoneClassLive draws it: the name at the card titles' size, the countdown at the right, the
 * controls on a line of their own.
 */
export function LiveHeader({
  name,
  joinCode,
  counts,
  startedAt,
  endsAt,
  children,
}: {
  name: string;
  joinCode: string;
  counts: StateCounts | null;
  startedAt: string | null;
  endsAt: string | null;
  children: ReactNode;
}) {
  const now = useClock(endsAt);
  return (
    <header className="flex flex-wrap items-center gap-x-4.5 gap-y-3.5 max-sm:gap-x-3.5">
      <Ring share={startedAt && endsAt ? shareLeft(startedAt, endsAt, now) : 0} />
      <div className="min-w-0 max-sm:flex-1">
        <h1 className="text-page-title text-balance wrap-anywhere max-sm:text-h3">{name}</h1>
        <p className="mt-0.5 text-meta text-text-secondary">
          {counts ? `Live · ${counts.joined} of ${counts.total} joined · ` : 'Live · '}
          {'join\u00a0code\u00a0'}
          <span translate="no" className="font-mono font-medium">
            {joinCode}
          </span>
        </p>
      </div>
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
      <div className="ml-auto flex flex-wrap items-center gap-2 max-sm:ml-0 max-sm:basis-full">
        {children}
      </div>
    </header>
  );
}

/**
 * The class right now, counted over the grid (ClassLive): six small chips in their states' tints,
 * icons and words, the count first ("17 Focused", "3 Not here"), a zero too, so none moves as
 * another comes and goes.
 */
export function LiveCounts({ counts }: { counts: StateCounts }) {
  return (
    <ul aria-label="The class right now" className="flex flex-wrap items-center gap-2">
      {COUNTED.map((state) => {
        const { label, icons, tone } = CHIP[state];
        const [Icon] = icons;
        return (
          <li
            key={state}
            className={`inline-flex items-center gap-1.5 rounded-full border-[1.5px] px-2.5 py-0.75 text-caption font-medium whitespace-nowrap tabular-nums ${tone}`}
          >
            {Icon ? <Icon size={13} aria-hidden="true" className="shrink-0" /> : null}
            {`${counts.counts[state]} ${label}`}
          </li>
        );
      })}
    </ul>
  );
}
