'use client';

import {
  CircleCheck,
  Flag,
  LockOpen,
  type LucideIcon,
  ShieldCheck,
  ShieldOff,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { Fragment, useEffect, useId, useState } from 'react';

import type { Mark, Moment, Timeline as View } from '@/lib/recap';

/**
 * Each moment's words, icon, fill and ink: its state's pair (DESIGN.md §2), never colour alone.
 * The owner's labels (2026-10-06), and the grid's own words for its states.
 */
const MOMENT: Record<Moment, [label: string, Icon: LucideIcon | null, fill: string, ink: string]> =
  {
    in: ['Tapped in', null, 'bg-text-secondary', 'text-text-primary'],
    unlock: ['Unlocked', LockOpen, 'bg-state-emergency-bg', 'text-state-emergency-fg'],
    focus: ['Back in focus', CircleCheck, 'bg-state-focused-bg', 'text-state-focused-fg'],
    off: ['Protection off', ShieldOff, 'bg-state-revoked-bg', 'text-state-revoked-fg'],
    on: ['Protection back on', ShieldCheck, 'bg-state-notjoined-bg', 'text-state-notjoined-fg'],
    silent: ['Silent', WifiOff, 'bg-state-ended-bg', 'text-state-ended-fg'],
    back: ['Checked in again', Wifi, 'bg-state-notjoined-bg', 'text-state-notjoined-fg'],
    left: ['Left', Flag, 'bg-state-ended-bg', 'text-state-ended-fg'],
  };

/**
 * A mark's look: a 20 px disc with its icon, edged in the card's colour so the line breaks around
 * it; Tapped in a 12 px dot; Silent edged dashed, as its chip is.
 */
function look(moment: Moment): string {
  const [, , fill, ink] = MOMENT[moment];
  if (moment === 'in') return `size-3 rounded-full border-2 border-surface-card ${fill}`;
  const edge =
    moment === 'silent'
      ? 'border border-dashed border-border-strong'
      : 'border-2 border-surface-card';
  return `grid size-5 place-items-center rounded-full ${edge} ${fill} ${ink}`;
}

/**
 * Where each of a row's marks sits, as CSS `left` (its centre): at its time, or right after the
 * marks before it, packed edge to edge by their widths as `look` draws them, whichever is later;
 * and never past the end less the room the marks after it take. So marks under a minute apart
 * sit side by side, each seen and hovered on its own at any width, nudged no further than they
 * must be; a mark's time is in its label and its card all the same. CSS works it out at the
 * axis's own width, so nothing is measured. Marks only, never a bar.
 * ponytail: a row with more marks than its axis has room for piles its first ones up, overlapping,
 * at its start; and each mark's style names every mark before it, so a row's styles grow with the
 * square of its marks (~30 KB for 50). Drop the terms that can't bind if either ever shows.
 */
export function lefts(marks: readonly Pick<Mark, 'moment' | 'x'>[]): string[] {
  let edge = 0;
  const packed = marks.map(({ moment, x }) => {
    const width = moment === 'in' ? 12 : 20;
    edge += width;
    return { x, centre: edge - width / 2 };
  });
  const end = packed.at(-1)?.centre ?? 0;
  return packed.map(({ x, centre }, i) => {
    if (packed.length === 1) return `${x}%`;
    const after = packed.slice(0, i).map((p) => `calc(${p.x}% + ${centre - p.centre}px)`);
    const at = after.length > 0 ? `max(${x}%, ${after.join(', ')})` : `${x}%`;
    const room = end - centre;
    return `min(${at}, ${room > 0 ? `max(0%, calc(100% - ${room}px))` : '100%'})`;
  });
}

function Glyph({ moment, size = 12 }: { moment: Moment; size?: number }) {
  const [, Icon] = MOMENT[moment];
  return Icon ? <Icon size={size} aria-hidden="true" className="shrink-0" /> : null;
}

/** Side by side from where the names' column leaves the axis room; stacked on a phone. */
const ROW = 'grid gap-x-6 gap-y-1 @min-[40rem]:grid-cols-[12.5rem_minmax(0,1fr)]';
/** The card opens toward the axis's middle, so it never runs off a narrow one. */
const FLIP = '-translate-x-[calc(100%_-_36px)]';
const FLIP_NARROW = '@max-[56rem]:-translate-x-[calc(100%_-_36px)]';

/**
 * The session's timeline (the Recap & reports design): a legend of the marks it shows, the axis,
 * and a row per student, each moment a mark at its time. A mark is a button: hovered or focused,
 * it opens a card saying what, who, when and, but in Present, an unlock's reason, which its label
 * says too; the pointer can move onto it. Marks too close to tell apart sit side by side
 * (`lefts`).
 */
export function Timeline({ view, label }: { view: View; label: string }) {
  const id = useId();
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const open = hovered ?? focused;
  // Where each mark whose card opened sits, in percent of its axis: `lefts` may have moved it off
  // its time, and its card opens toward the axis's middle from where the mark is, never past an end.
  const [placedAt, setPlacedAt] = useState<Record<string, number>>({});
  const opening = (key: string, mark: HTMLElement) => {
    const axis = mark.offsetParent?.clientWidth;
    if (!axis) return;
    const at = ((mark.offsetLeft + mark.offsetWidth / 2) / axis) * 100;
    setPlacedAt((p) => ({ ...p, [key]: at }));
  };
  const last = view.ticks.length - 1;
  const hover = (key: string | null) => () => setHovered(key);
  // Escape closes the open card wherever focus is, without moving the pointer (WCAG 1.4.13).
  useEffect(() => {
    if (open === null) return;
    const close = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setHovered(null);
      setFocused(null);
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [open]);
  // Who joined, then anyone with a mark there who never did, under words of their own: one who
  // unlocked without joining is never listed as one who joined.
  const groups = (
    [
      ['Who joined', view.rows.slice(0, view.joined)],
      ["Didn't join", view.rows.slice(view.joined)],
    ] as const
  ).filter(([, rows]) => rows.length > 0);
  // Each row's marks, side by side where they would overlap (`lefts`).
  const placed = new Map(view.rows.map((row) => [row.key, lefts(row.marks)]));
  return (
    <section aria-label={label} className="mt-6">
      <ul
        aria-label="What the marks mean"
        className="flex flex-wrap items-center gap-x-5 gap-y-2 text-caption text-text-secondary"
      >
        {view.moments.map((m) => (
          <li key={m} className="inline-flex items-center gap-2">
            <span className={`shrink-0 ${look(m)}`}>
              <Glyph moment={m} />
            </span>
            {MOMENT[m][0]}
          </li>
        ))}
      </ul>
      {view.moments.includes('unlock') ? null : (
        <p className="mt-3 text-body text-text-secondary">No unlocks.</p>
      )}
      <div className={`mt-5 items-end pb-2 ${ROW}`}>
        <span id={`${id}-0`} className="text-caption text-text-tertiary">
          {groups[0]?.[0]}
        </span>
        {/* Narrower, every other time between the ends, then none, so no two labels touch. */}
        <div aria-hidden="true" className="relative h-4.5">
          {view.ticks.map((t, i) => (
            <span
              key={i}
              style={{ left: `${t.x}%` }}
              className={`absolute top-0 text-caption whitespace-nowrap text-text-tertiary ${i === 0 ? '' : i === last ? '-translate-x-full' : `-translate-x-1/2 @max-[28rem]:hidden ${i % 2 ? '@max-[64rem]:hidden' : ''}`}`}
            >
              {t.label}
            </span>
          ))}
        </div>
      </div>
      {groups.map(([heading, rows], g) => (
        <Fragment key={heading}>
          {g > 0 ? (
            <p id={`${id}-${g}`} className="mt-4 pb-2 text-caption text-text-tertiary">
              {heading}
            </p>
          ) : null}
          <ul aria-labelledby={`${id}-${g}`}>
            {rows.map((row) => (
              <li key={row.key} className={`items-center ${ROW}`}>
                <span className="min-w-0 text-body break-words">{row.name}</span>
                <div
                  style={{ backgroundSize: `${view.step}% 100%` }}
                  className="relative h-9 border-r border-border-default bg-[linear-gradient(to_right,var(--bali-border-default)_1px,transparent_1px)]"
                >
                  {/* From the first mark to the end, the same for everyone: never a student's minutes. */}
                  {row.marks.length > 0 ? (
                    <span
                      style={{ left: placed.get(row.key)?.[0] }}
                      className="absolute top-[17px] right-0 h-0.5 rounded-full bg-border-strong"
                    />
                  ) : null}
                  {row.marks.map((m, i) => {
                    const [words, , , ink] = MOMENT[m.moment];
                    const left = placed.get(row.key)?.[i];
                    const at = placedAt[m.key] ?? m.x;
                    return (
                      <Fragment key={m.key}>
                        <button
                          type="button"
                          aria-label={`${row.name}, ${words.toLowerCase()} at ${m.time}${m.reason ? `, ${m.reason}` : ''}`}
                          style={{ left }}
                          onMouseEnter={(e) => {
                            opening(m.key, e.currentTarget);
                            setHovered(m.key);
                          }}
                          onMouseLeave={hover(null)}
                          onFocus={(e) => {
                            opening(m.key, e.currentTarget);
                            setFocused(m.key);
                          }}
                          onBlur={() => setFocused(null)}
                          className={`absolute z-1 cursor-pointer before:absolute before:inset-x-0 before:bottom-full before:h-2.5 ${m.moment === 'in' ? 'top-3 -ml-1.5' : 'top-2 -ml-2.5'} ${look(m.moment)} ${open === m.key ? 'outline-2 outline-offset-2 outline-focus-ring' : ''}`}
                        >
                          <Glyph moment={m.moment} />
                        </button>
                        {open === m.key ? (
                          <div
                            aria-hidden="true"
                            style={{ left }}
                            onMouseEnter={hover(m.key)}
                            onMouseLeave={hover(null)}
                            className={`absolute bottom-[calc(100%_-_4px)] z-2 -ml-4.5 w-max max-w-[min(16rem,calc(50%_+_18px))] rounded-md border border-border-default bg-surface-raised px-4 py-3 text-body break-words shadow-2 @min-[56rem]:max-w-[min(16rem,calc(30%_+_18px))] ${at > 70 ? FLIP : at > 50 ? FLIP_NARROW : ''}`}
                          >
                            <p className={`flex items-center gap-2 font-semibold ${ink}`}>
                              <Glyph moment={m.moment} size={14} />
                              {words}
                            </p>
                            <p className="mt-0.5 text-caption text-text-secondary">
                              {row.name} · {m.time}
                            </p>
                            {m.reason ? <p className="mt-1">{m.reason}</p> : null}
                          </div>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        </Fragment>
      ))}
    </section>
  );
}
