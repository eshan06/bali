'use client';

import type { PortalEvent } from '@bali/shared';
import { createContext, useContext, useEffect, useRef } from 'react';

/** Counts a teacher's action (A3b; `countAction`, which the shell binds to its client). */
type Count = (event: PortalEvent) => void;

/**
 * The shell's sender while its one read of the account says a teacher's; null for anyone else and
 * until it says so. The gate is the account, never the page: `/` serves students too.
 */
export const CountContext = createContext<Count | null>(null);

/** Counts a teacher's action once it has happened: null, nothing to count, for anyone else. */
export const useCount = (): Count | null => useContext(CountContext);

/**
 * Counts `event` once each time `shown` turns true (an opening: Present, a report, the recap), as
 * soon as the account reads as a teacher's: never at a re-render, nor twice for React's
 * development double effects.
 */
export function useCountOpened(event: PortalEvent, shown: boolean): void {
  const count = useCount();
  const counted = useRef(false);
  useEffect(() => {
    if (!shown) counted.current = false;
    else if (count !== null && !counted.current) {
      counted.current = true;
      count(event);
    }
  }, [count, event, shown]);
}
