import type { FastifyBaseLogger } from 'fastify';

import { captureWarning } from './monitoring.js';

/*
 * The API's database pool, said once at boot (main.ts; DECISIONS 2026-10-22). Its size is always
 * the API's own number (`createDb`): passed none, postgres.js 3.4.9 would size it by PGMAX or a
 * `max` in DATABASE_URL, each read as text, and a pool of "20" is one connection. So either, set,
 * is ignored, and the boot names it: never its value, and never the URL, which holds the database's
 * password.
 */

/** The pool sizes postgres.js would have read here, by name, each ignored. */
export function ignoredPoolSizes(databaseUrl: string, pgmax: string | undefined): string[] {
  const ignored: string[] = [];
  // Blank, postgres.js reads it as unset too.
  if (pgmax) ignored.push('PGMAX');
  // The query as postgres.js reads it, after the first `?` and before any `#`; never a throw.
  const [beforeFragment = ''] = databaseUrl.split('#', 1);
  const query = beforeFragment.indexOf('?');
  if (query >= 0 && new URLSearchParams(beforeFragment.slice(query + 1)).has('max')) {
    ignored.push('the max parameter in DATABASE_URL');
  }
  return ignored;
}

/** The pool's size in the log; and a warning naming each ignored size, in the log and to monitoring. */
export function sayDatabasePool(
  log: FastifyBaseLogger,
  connections: number,
  ignored: readonly string[],
): void {
  if (ignored.length === 0) {
    log.info({ connections }, `database pool: ${connections} connections`);
    return;
  }
  const message = `${ignored.join(' and ')} ${ignored.length === 1 ? 'is' : 'are'} ignored: the API sizes its own database pool, ${connections} connections (docs/DECISIONS.md, 2026-10-22)`;
  log.warn({ connections }, message);
  captureWarning(message, 'boot');
}
