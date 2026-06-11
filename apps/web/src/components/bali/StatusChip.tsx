'use client';

import clsx from 'clsx';
import { CHIP_STATES, formatCountdown, staleBadgeText, type ChipState, type ParticipantDTO } from '@bali/shared';
import { ICON_STROKE, STATE_ICONS } from './icons';

/** Literal class strings per state so Tailwind keeps them (no template classnames). */
const STATE_CLASSES: Record<ChipState, string> = {
  not_joined: 'text-state-notjoined-fg bg-state-notjoined-bg',
  focused: 'text-state-focused-fg bg-state-focused-bg',
  pass: 'text-state-pass-fg bg-state-pass-bg',
  emergency_unlocked: 'text-state-emergency-fg bg-state-emergency-bg',
  revoked: 'text-state-revoked-fg bg-state-revoked-bg',
  no_device: 'text-state-nodevice-fg bg-transparent border-[1.5px] border-dashed border-current',
  ended: 'text-state-ended-fg bg-state-ended-bg',
};

const SIZES = {
  grid: { chip: 'text-[16px] leading-[22px] px-4 py-2.5 gap-[9px]', icon: 18 },
  proj: { chip: 'text-[20px] leading-[26px] px-5 py-[13px] gap-[11px]', icon: 22 },
  mini: { chip: 'text-[13px] leading-[18px] px-[11px] py-1 gap-1.5', icon: 13 },
} as const;

export type ChipSize = keyof typeof SIZES;

/** Live label: pass chips tick ("Pass · 4:32"), everything else uses spec labels. */
export function chipLabel(p: Pick<ParticipantDTO, 'state' | 'passRemainingSeconds'>, nowMs?: number): string {
  if (p.state === 'pass' && p.passRemainingSeconds !== null) {
    return `Pass · ${formatCountdown(p.passRemainingSeconds)}`;
  }
  void nowMs;
  return CHIP_STATES[p.state].label;
}

export function StatusChip({
  state,
  name,
  label,
  size = 'grid',
  stale,
  selected = false,
  pulse = false,
  onClick,
}: {
  state: ChipState;
  name?: string;
  /** Defaults to the canonical state label. */
  label?: string;
  size?: ChipSize;
  /** Seconds since last heartbeat when the staleness badge should show. */
  stale?: number | null;
  selected?: boolean;
  pulse?: boolean;
  onClick?: () => void;
}) {
  const Icon = STATE_ICONS[state];
  const sz = SIZES[size];
  const text = label ?? CHIP_STATES[state].label;
  const interactive = !!onClick;
  const isStale = stale !== null && stale !== undefined;

  return (
    <span
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      aria-label={
        name
          ? `${name}, ${text}${isStale ? `, last seen ${staleBadgeText(stale)} ago` : ''}${interactive ? '. Button' : ''}`
          : undefined
      }
      className={clsx(
        'inline-flex items-center whitespace-nowrap rounded-full font-semibold tnum',
        'transition-[background,color] duration-fast ease-standard',
        STATE_CLASSES[state],
        sz.chip,
        interactive && 'cursor-pointer hover:brightness-[0.965] active:brightness-[0.93]',
        selected && 'shadow-focus',
        pulse && 'pulse-once',
      )}
    >
      <Icon size={sz.icon} strokeWidth={ICON_STROKE} className={clsx('flex-none', isStale && 'opacity-60')} />
      {name ? <span className={clsx(isStale && 'opacity-60')}>{name}</span> : null}
      <span className={clsx('font-medium opacity-[0.92]', isStale && 'opacity-60')}>{text}</span>
      {isStale ? (
        <span className="ml-0.5 inline-flex items-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-[14px] tracking-[0.02em] opacity-75 bg-[rgba(22,21,19,0.08)]">
          {staleBadgeText(stale)}
        </span>
      ) : null}
    </span>
  );
}

export function SummaryStrip({
  counts,
  passLabel,
  size = 'mini',
}: {
  counts: Record<ChipState, number>;
  /** Optional live pass countdown shown on the pass chip (portal live card). */
  passLabel?: string | null;
  size?: ChipSize;
}) {
  const order: ChipState[] = ['focused', 'not_joined', 'pass', 'emergency_unlocked', 'revoked', 'no_device'];
  const labels: Record<ChipState, string> = {
    focused: 'Focused',
    not_joined: 'Not in',
    pass: 'Pass',
    emergency_unlocked: 'Unlocked',
    revoked: 'Permission off',
    no_device: 'No device',
    ended: 'Ended',
  };
  return (
    <div className="flex flex-wrap items-center gap-2" role="status" aria-label="Session summary">
      {order
        .filter((st) => counts[st] > 0)
        .map((st) => (
          <StatusChip
            key={st}
            state={st}
            size={size}
            label={`${counts[st]} ${st === 'pass' && passLabel ? passLabel : labels[st]}`}
          />
        ))}
    </div>
  );
}
