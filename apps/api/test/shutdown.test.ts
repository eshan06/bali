import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeShutdown } from '../src/shutdown.js';

/*
 * Unit tests for the shutdown handler, with a controllable close() and fake
 * timers — the process-level integration lives in boot.test.ts, but only a
 * pending close() makes the guard and the deadline observable, which a real
 * idle server resolves too fast to pin.
 */

function fakeApp() {
  const logs: { level: 'info' | 'error'; msg: string }[] = [];
  let resolveClose: () => void = () => undefined;
  let rejectClose: (err: unknown) => void = () => undefined;
  const closePromise = new Promise<void>((res, rej) => {
    resolveClose = res;
    rejectClose = rej;
  });
  const closeIdleConnections = vi.fn();
  const close = vi.fn(() => closePromise);
  // pino accepts both log.error(msgString) and log.error(obj, msg).
  const record = (level: 'info' | 'error') => (objOrMsg: unknown, msg?: string) =>
    logs.push({ level, msg: msg ?? (typeof objOrMsg === 'string' ? objOrMsg : '') });
  const app = {
    log: { info: record('info'), error: record('error') },
    server: { closeIdleConnections },
    close,
  } as unknown as FastifyInstance;
  return { app, logs, close, closeIdleConnections, resolveClose, rejectClose };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('makeShutdown', () => {
  it('a second signal while close() is pending logs and does not close twice', () => {
    const { app, logs, close } = fakeApp();
    const exit = vi.fn();
    const shutdown = makeShutdown(app, { deadlineMs: 8000, exit });

    shutdown('SIGINT');
    shutdown('SIGTERM');
    shutdown('SIGTERM');

    expect(close).toHaveBeenCalledTimes(1);
    expect(logs.filter((l) => l.msg === 'shutting down')).toHaveLength(1);
    expect(logs.filter((l) => l.msg === 'already shutting down')).toHaveLength(2);
    expect(exit).not.toHaveBeenCalled();
  });

  it('exits 0 when close() resolves', async () => {
    const { app, close, resolveClose } = fakeApp();
    const exit = vi.fn();
    makeShutdown(app, { deadlineMs: 8000, exit })('SIGTERM');

    resolveClose();
    await vi.advanceTimersByTimeAsync(0);

    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('exits 1 when close() rejects', async () => {
    const { app, logs, rejectClose } = fakeApp();
    const exit = vi.fn();
    makeShutdown(app, { deadlineMs: 8000, exit })('SIGTERM');

    rejectClose(new Error('hook blew up'));
    await vi.advanceTimersByTimeAsync(0);

    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(logs.some((l) => l.msg === 'shutdown failed')).toBe(true);
  });

  it('sweeps idle connections while close() drains', async () => {
    const { app, closeIdleConnections } = fakeApp();
    makeShutdown(app, { deadlineMs: 8000, exit: vi.fn() })('SIGTERM');

    await vi.advanceTimersByTimeAsync(1000);

    expect(closeIdleConnections.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('the deadline exits 1 when close() never settles', async () => {
    const { app, logs } = fakeApp();
    const exit = vi.fn();
    makeShutdown(app, { deadlineMs: 8000, exit })('SIGTERM');

    await vi.advanceTimersByTimeAsync(7999);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);

    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(logs.some((l) => l.msg === 'shutdown timed out; exiting')).toBe(true);
  });
});
