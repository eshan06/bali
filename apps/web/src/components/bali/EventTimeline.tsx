'use client';

import clsx from 'clsx';
import type { EventDTO } from '@bali/shared';
import { clock24 } from '@/lib/format';
import { ICON_STROKE, STATE_ICONS } from './icons';
import { Circle, Flag, UserPlus, type LucideIcon } from 'lucide-react';

/** Event type → state-colored dot, per the component spec. */
function dotFor(type: EventDTO['type']): { icon: LucideIcon; cls: string } {
  switch (type) {
    case 'tapped_in':
    case 'refocused':
    case 'session_started':
    case 'permission_restored':
    case 'member_joined':
    case 'member_approved':
      return { icon: STATE_ICONS.focused, cls: 'bg-state-focused-bg text-state-focused-fg' };
    case 'pass_granted':
    case 'pass_ended':
      return { icon: STATE_ICONS.pass, cls: 'bg-state-pass-bg text-state-pass-fg' };
    case 'emergency_unlock':
    case 'reason_shared':
      return { icon: STATE_ICONS.emergency_unlocked, cls: 'bg-state-emergency-bg text-state-emergency-fg' };
    case 'permission_revoked':
      return { icon: STATE_ICONS.revoked, cls: 'bg-state-revoked-bg text-state-revoked-fg' };
    case 'session_ended':
      return { icon: Flag, cls: 'bg-surface-sunken text-ink-secondary' };
    case 'member_requested':
      return { icon: UserPlus, cls: 'bg-surface-sunken text-ink-secondary' };
    default:
      return { icon: Circle, cls: 'bg-surface-sunken text-ink-secondary' };
  }
}

export function EventTimeline({ events, className }: { events: EventDTO[]; className?: string }) {
  return (
    <div className={clsx('flex flex-col', className)}>
      {events.map((ev, i) => {
        const { icon: Icon, cls } = dotFor(ev.type);
        return (
          <div key={ev.id} className="relative grid grid-cols-[26px_1fr_auto] items-start gap-2.5 pb-[18px] last:pb-0">
            {i < events.length - 1 ? (
              <span aria-hidden className="absolute bottom-0.5 left-[12.5px] top-6 w-px bg-line" />
            ) : null}
            <span className={clsx('relative z-[1] flex h-[26px] w-[26px] items-center justify-center rounded-full', cls)}>
              <Icon size={13} strokeWidth={ICON_STROKE} />
            </span>
            <div className="pt-[3px] text-[14px] leading-5 text-ink-primary">
              {ev.title}
              {ev.subtitle ? (
                <span className="block text-[12.5px] leading-[17px] text-ink-secondary">{ev.subtitle}</span>
              ) : null}
            </div>
            <span className="pt-1 text-[12.5px] font-medium leading-[17px] text-ink-tertiary tnum">
              {clock24(ev.at)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
