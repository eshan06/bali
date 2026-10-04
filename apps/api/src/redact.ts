/*
 * One rule for what an error may say once it leaves a request (Phase 6, S2):
 * the API's logs and Sentry (`monitoring.ts`, P1) both scrub with it. A
 * database failure keeps its error class, its SQL text and its stack; the
 * values that went into the query, and the ones Postgres echoes back, never
 * leave.
 */

/** Drizzle's query errors end `\nparams: <values>` — the values are student data. */
const PARAMS = /\bparams:[\s\S]*$/;
/**
 * Postgres echoes values in errors: the offending row (`Key (email)=(a@b.c)`,
 * `Failing row contains (…)`), cut to the end of its line since a value can
 * hold a `)`; and a rejected input (`invalid input syntax for type uuid: "…"`).
 */
const ROW_VALUES = /(Key \([^)]*\)=|Failing row contains ).*/g;
const INPUT_VALUE = /(invalid input (?:syntax|value) for [^:\n]*: |out of range: )".*/g;
/** The same, said other ways: `value "…" is out of range`, bad JSON's `Token "…" is invalid`. */
const QUOTED_VALUE = /(value |Token )"[^"\n]*"/g;
/** Bad JSON's context line: `JSON data, line 1: …`. */
const JSON_CONTEXT = /(JSON data, line \d+: ).*/g;

/** A message, stack or Postgres detail with every value cut out. */
export function scrubText(text: string): string {
  return text
    .replace(PARAMS, 'params: [scrubbed]')
    .replace(ROW_VALUES, '$1([scrubbed])')
    .replace(INPUT_VALUE, '$1[scrubbed]')
    .replace(QUOTED_VALUE, '$1[scrubbed]')
    .replace(JSON_CONTEXT, '$1[scrubbed]');
}

/**
 * Fields that hold a query's values outright: Drizzle's `params`, and the
 * `parameters` a driver error carries (postgres.js, in debug mode).
 */
const VALUE_FIELDS = new Set(['params', 'parameters']);

/** A plain value with every string scrubbed and every value field dropped. */
function scrubValue(value: unknown, seen: Set<object>): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (typeof value !== 'object' || value === null) return value;
  // Raw bytes cannot be scrubbed, so they never go.
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return '[binary]';
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, seen));
  if (value instanceof Error) return serializeErrorInner(value, seen);
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    if (!VALUE_FIELDS.has(key)) out[key] = scrubValue(field, seen);
  }
  return out;
}

/**
 * The stack with its message scrubbed and its frames kept: `scrubText` on the
 * whole stack would cut Drizzle's `params:` to the end, frames and all. A
 * stack that does not hold the message as thrown is scrubbed whole.
 */
function scrubStack(err: Error): string {
  const stack = err.stack ?? '';
  const at = err.message === '' ? -1 : stack.indexOf(err.message);
  if (at < 0) return scrubText(stack);
  const frames = stack.slice(at + err.message.length);
  return scrubText(stack.slice(0, at)) + scrubText(err.message) + scrubText(frames);
}

function serializeErrorInner(err: Error, seen: Set<object>): Record<string, unknown> {
  seen.add(err);
  const out: Record<string, unknown> = {
    type: err.constructor.name || err.name,
    message: scrubText(err.message),
    stack: scrubStack(err),
  };
  // Own fields: Drizzle's `query` (the SQL, `$1` placeholders only), a
  // Postgres error's `code`, `detail`, `constraint`, `table`, `column`…
  for (const [key, field] of Object.entries(err)) {
    if (!VALUE_FIELDS.has(key) && !(key in out)) out[key] = scrubValue(field, seen);
  }
  // Drizzle wraps the driver's error as a non-enumerable `cause`.
  if (err.cause !== undefined && !('cause' in out)) out.cause = scrubValue(err.cause, seen);
  return out;
}

/** What the logger writes under `err`: pino's shape, as Fastify's types expect it. */
export interface SerializedError {
  [key: string]: unknown;
  type: string;
  message: string;
  stack: string;
}

/**
 * The logger's `err` serializer: pino's shape (`type`, `message`, `stack`, own
 * fields, the cause), every value scrubbed. pino passes whatever sits under
 * `err`, so anything that is not an Error is scrubbed the same way.
 */
export function serializeError(err: Error): SerializedError {
  const value: unknown = err;
  return (
    value instanceof Error ? serializeErrorInner(value, new Set()) : scrubValue(value, new Set())
  ) as SerializedError;
}

/**
 * Headers that are never logged, wherever a headers object turns up in a log
 * line: the bearer token, the internal key, a cookie.
 */
export const LOG_REDACT = {
  paths: [
    'headers.authorization',
    'headers["x-internal-key"]',
    'headers.cookie',
    '*.headers.authorization',
    '*.headers["x-internal-key"]',
    '*.headers.cookie',
  ],
  censor: '[redacted]',
};
