'use client';

import { type ReactNode, useEffect, useState } from 'react';

import { bellTime } from '@/lib/session-controls';

import { CODE_CHIP } from './join-code';
import { CHIP, COUNTED, type StateCounts } from './live-grid';

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

/**
 * The session's ring: the time left as a green arc from the top, on its track. ClassLive's is 44 px,
 * r 19.5, stroked 5; ClassPresent's one size up, 64 px, r 28.5, stroked 7.
 */
function Ring({ share, big }: { share: number; big: boolean }) {
  const [box, stroke] = big ? [64, 7] : [44, 5];
  const c = box / 2;
  const r = c - stroke / 2;
  const around = 2 * Math.PI * r;
  return (
    <svg
      width={box}
      height={box}
      viewBox={`0 0 ${box} ${box}`}
      aria-hidden="true"
      className="shrink-0"
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

/** The header's type: ClassLive's, and ClassPresent's one size up, read from the back of the room. */
const TYPE = {
  live: {
    title: 'text-page-title text-balance wrap-anywhere max-sm:text-h3',
    line: 'text-meta',
    time: 'text-data-lg',
    sub: 'text-countdown-sub',
  },
  present: {
    title: 'text-present-title text-balance wrap-anywhere',
    line: 'text-h3 font-normal',
    time: 'text-present-countdown',
    sub: 'text-present-caption',
  },
};

/**
 * A class's header while a session runs (PV7; ClassLive): the ring, the name over "Live · 25 of 28
 * joined · join code VMAF7E", the countdown to the server's bell on this computer's clock with the
 * bell's time under it, then the controls (`children`) at the end. Until the grid is counted the
 * line says "Live" and the code; until the bell is known the countdown says "…". On a phone, as
 * PhoneClassLive draws it: the name at the card titles' size, the countdown at the right, the
 * controls on a line of their own. In Present (PV9; ClassPresent) one size up, the code out of the
 * line in a well of its own at 34/44; after the bell there (`over`, PresentEnded) the ring whole,
 * that line in place of the live one, and no countdown.
 */
export function LiveHeader({
  name,
  joinCode,
  counts,
  startedAt,
  endsAt,
  present = false,
  over = null,
  children,
}: {
  name: string;
  joinCode: string;
  counts: StateCounts | null;
  startedAt: string | null;
  endsAt: string | null;
  present?: boolean;
  over?: string | null;
  children: ReactNode;
}) {
  const now = useClock(over === null ? endsAt : null);
  const type = TYPE[present ? 'present' : 'live'];
  const line = over ?? (counts ? `Live · ${counts.joined} of ${counts.total} joined` : 'Live');
  const share = over !== null ? 1 : startedAt && endsAt ? shareLeft(startedAt, endsAt, now) : 0;
  return (
    <header className="flex flex-wrap items-center gap-x-4.5 gap-y-3.5 max-sm:gap-x-3.5">
      <Ring share={share} big={present} />
      <div className="min-w-0 max-sm:flex-1">
        <h1 className={type.title}>{name}</h1>
        <p className={`mt-0.5 ${type.line} text-text-secondary`}>
          {present ? (
            line
          ) : (
            <>
              {`${line} · `}
              {'join\u00a0code\u00a0'}
              <span translate="no" className="font-mono font-medium">
                {joinCode}
              </span>
            </>
          )}
        </p>
      </div>
      {over === null ? (
        <p className="flex flex-col border-l border-border-default pl-4.5 max-sm:border-l-0 max-sm:pl-0 max-sm:text-right">
          {endsAt ? (
            <>
              <span className={`font-num ${type.time} tabular-nums`}>
                {timeLeft(Date.parse(endsAt) - now)}
              </span>
              <span className={`${type.sub} text-text-secondary`}>
                ends <time dateTime={endsAt}>{bellTime(endsAt)}</time>
              </span>
            </>
          ) : (
            <>
              <span className={`font-num ${type.time} text-text-tertiary`}>…</span>
              <span className={type.sub}>{'\u00a0'}</span>
            </>
          )}
        </p>
      ) : null}
      {present ? (
        <p className="ml-3 flex flex-wrap items-center gap-2.5">
          <span className="text-present-caption text-text-tertiary">Join code</span>
          <span
            translate="no"
            className={`${CODE_CHIP} rounded-frame py-2 pr-4.5 pl-[calc(18px+0.16em)] text-code-present`}
          >
            {joinCode}
          </span>
        </p>
      ) : null}
      <div className="ml-auto flex flex-wrap items-center gap-2 max-sm:ml-0 max-sm:basis-full">
        {children}
      </div>
    </header>
  );
}

/**
 * The class right now, counted over the grid (ClassLive): six small chips in their states' tints,
 * icons and words, the count first ("17 Focused", "3 Not here"), a zero too, so none moves as
 * another comes and goes. In Present (ClassPresent) one size up: 16/22, 8 × 15 px in, 18 px icons.
 */
export function LiveCounts({
  counts,
  present = false,
}: {
  counts: StateCounts;
  present?: boolean;
}) {
  const size = present
    ? 'gap-2.25 px-3.75 py-2 text-present-caption'
    : 'gap-1.5 px-2.5 py-0.75 text-caption';
  return (
    <ul aria-label="The class right now" className="flex flex-wrap items-center gap-2">
      {COUNTED.map((state) => {
        const { label, icons, tone } = CHIP[state];
        const [Icon] = icons;
        return (
          <li
            key={state}
            className={`inline-flex items-center rounded-full border-[1.5px] ${size} font-medium whitespace-nowrap tabular-nums ${tone}`}
          >
            {Icon ? (
              <Icon size={present ? 18 : 13} aria-hidden="true" className="shrink-0" />
            ) : null}
            {`${counts.counts[state]} ${label}`}
          </li>
        );
      })}
    </ul>
  );
}
