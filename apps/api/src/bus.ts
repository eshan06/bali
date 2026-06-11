import type { SSEMessage } from '@bali/shared';

type Listener = (msg: SSEMessage) => void;

/**
 * In-process fan-out for live session updates (one API instance — documented
 * constraint in WIRING_PLAN §1). Web consumes it over SSE; transport loss on the
 * client falls back to 5s polling, so this bus is an accelerator, not a correctness
 * dependency.
 */
class SessionBus {
  private listeners = new Map<string, Set<Listener>>();

  subscribe(sessionId: string, fn: Listener): () => void {
    let set = this.listeners.get(sessionId);
    if (!set) {
      set = new Set();
      this.listeners.set(sessionId, set);
    }
    set.add(fn);
    return () => {
      set.delete(fn);
      if (set.size === 0) this.listeners.delete(sessionId);
    };
  }

  publish(sessionId: string, msg: SSEMessage): void {
    const set = this.listeners.get(sessionId);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(msg);
      } catch {
        // a broken consumer never takes down the publisher
      }
    }
  }
}

export const bus = new SessionBus();
