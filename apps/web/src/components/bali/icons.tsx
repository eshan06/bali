'use client';

import {
  Circle,
  CircleCheck,
  Flag,
  LockOpen,
  ShieldOff,
  Smartphone,
  Ticket,
  type LucideIcon,
} from 'lucide-react';
import type { ChipState } from '@bali/shared';

/** Spec: Lucide at 1.75px stroke, single set, no mixing. */
export const ICON_STROKE = 1.75;

export const STATE_ICONS: Record<ChipState, LucideIcon> = {
  not_joined: Circle,
  focused: CircleCheck,
  pass: Ticket,
  emergency_unlocked: LockOpen,
  revoked: ShieldOff,
  no_device: Smartphone,
  ended: Flag,
};
