import type { FastifyInstance } from 'fastify';

export interface ShutdownOptions {
  deadlineMs: number;
  /** Injection point for tests; defaults to process.exit. */
  exit?: (code: number) => void;
}

/**
 * Builds the signal handler that drains the server and exits.
 *
 * Why this is more than `app.close()`: close() sweeps idle sockets exactly
 * once, when it starts. A keep-alive socket carrying an in-flight request at
 * that moment is never re-swept after the response drains, so close() would
 * sit out the full keepAliveTimeout (72s by default) on a perfectly healthy
 * shutdown — while deploy platforms SIGKILL long before that. The periodic
 * re-sweep closes each socket the moment it goes idle, so a normal deploy
 * exits 0 right after the last response. The deadline is a backstop for a
 * genuinely stuck close (e.g. a hung onClose hook): log and exit non-zero on
 * our own terms instead of being SIGKILLed mid-mystery. Both timers are
 * unref'd so neither ever holds an otherwise-finished process open.
 */
export function makeShutdown(
  app: FastifyInstance,
  { deadlineMs, exit = (code) => process.exit(code) }: ShutdownOptions,
): (signal: NodeJS.Signals) => void {
  let closing = false;
  return function shutdown(signal: NodeJS.Signals): void {
    // Repeated signals must not start a second close() racing the first —
    // and the operator mashing Ctrl-C deserves feedback, not silence.
    if (closing) {
      app.log.info({ signal }, 'already shutting down');
      return;
    }
    closing = true;
    app.log.info({ signal }, 'shutting down');

    const sweep = setInterval(() => app.server.closeIdleConnections(), 250);
    sweep.unref();
    const deadline = setTimeout(() => {
      app.log.error('shutdown timed out; exiting');
      exit(1);
    }, deadlineMs);
    deadline.unref();

    app.close().then(
      () => {
        clearInterval(sweep);
        clearTimeout(deadline);
        exit(0);
      },
      (err: unknown) => {
        app.log.error(err, 'shutdown failed');
        exit(1);
      },
    );
  };
}
