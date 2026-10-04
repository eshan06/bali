import type { RouteOptions } from 'fastify';
import { writeFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  additiveOnly,
  broken,
  openApiDocument,
  readSnapshot,
  routeTable,
  serialize,
  SNAPSHOT_FILE,
} from './helpers/openapi.js';

/*
 * The API snapshot (Phase 4 · O1): contracts/openapi.json holds every route
 * the app registers and the request schema each one parses, generated here
 * from the app itself. This test fails when the app drifts from it, and
 * `npm run fixtures` (UPDATE_FIXTURES=1) rewrites it instead — CI runs that
 * too and fails on any diff, as it does for the contract fixtures. Either way,
 * a removal from /v1 fails first and nothing is written (additive-only): an
 * addition passes once the regenerated snapshot is committed.
 */

const UPDATE = process.env.UPDATE_FIXTURES === '1';

let routes: RouteOptions[];
let today: Record<string, unknown>;

beforeAll(async () => {
  routes = await routeTable();
  today = openApiDocument(routes);
});

/** `routes` with the route at `method url` changed by `change`, or removed when it returns null. */
function edit(method: string, url: string, change: (route: RouteOptions) => RouteOptions | null) {
  const target = routes.find((r) => r.method === method && r.url === url);
  if (!target) throw new Error(`no route ${method} ${url}`);
  return routes.flatMap((r) => (r === target ? (change(r) ?? []) : [r]));
}

/** `route` parsing `part` with `schema` instead. */
const parsing = (route: RouteOptions, part: 'params' | 'query' | 'body', schema: z.ZodType) => ({
  ...route,
  config: { ...route.config, parses: { ...route.config?.parses, [part]: schema } },
});

/** The schema `route` parses `part` with, as the object it is. */
function shape(route: RouteOptions, part: 'params' | 'query' | 'body') {
  const schema = route.config?.parses?.[part];
  if (!(schema instanceof z.ZodObject)) throw new Error(`${route.url} parses no ${part} object`);
  return schema;
}

describe('the API snapshot (contracts/openapi.json)', () => {
  it('is the surface the app has today, and keeps every /v1 promise', async () => {
    const committed = await readSnapshot();
    const before = committed === null ? {} : (JSON.parse(committed) as Record<string, unknown>);
    const breaks = broken(before, today);
    // First, so a regenerate never writes a removal over the snapshot.
    expect(breaks, additiveOnly(breaks)).toEqual([]);
    if (UPDATE) {
      await writeFile(SNAPSHOT_FILE, serialize(today));
      return;
    }
    expect(committed, 'contracts/openapi.json drifted: run npm run fixtures').toBe(
      serialize(today),
    );
  });

  it('lists every route the app registers, with what each one parses', () => {
    const paths = today.paths as Record<string, Record<string, Record<string, unknown>>>;
    const listed = Object.entries(paths).flatMap(([path, ops]) =>
      Object.keys(ops).map((method) => `${method.toUpperCase()} ${path}`),
    );
    const registered = routes
      .filter((r) => r.method !== 'HEAD')
      .map((r) => `${String(r.method)} ${r.url.replace(/:(\w+)/g, '{$1}')}`);
    expect(new Set(listed)).toEqual(new Set(registered));
    expect(listed).toContain('POST /v1/taps');
    // The leave's body is optional: the endpoint shipped with none (A19).
    const leave = paths['/v1/enrollments/{id}']!.delete!;
    expect(leave.requestBody).toMatchObject({ required: false });
    expect(paths['/v1/taps']!.post!.requestBody).toMatchObject({ required: true });
  });

  it('fails on a removed route', () => {
    const without = edit('POST', '/v1/taps', () => null);
    const breaks = broken(today, openApiDocument(without));
    // The route, and every field it was sent: nothing else.
    expect(breaks).toEqual(
      expect.arrayContaining([
        'POST /v1/taps',
        'POST /v1/taps body.tagId',
        'POST /v1/taps body.order',
      ]),
    );
    expect(
      breaks.filter((b) => b !== 'POST /v1/taps' && !b.startsWith('POST /v1/taps body.')),
    ).toEqual([]);
    expect(additiveOnly(breaks)).toMatch(/^Additive-only .*\n.*never removed/);
    expect(additiveOnly(breaks)).toContain('\n  POST /v1/taps body.order');
  });

  it('fails on a removed method, its path still served', () => {
    const without = edit('PATCH', '/v1/classes/:id', () => null);
    const breaks = broken(today, openApiDocument(without));
    expect(breaks).toEqual(
      expect.arrayContaining(['PATCH /v1/classes/{id}', 'PATCH /v1/classes/{id} body.name']),
    );
    expect(breaks.filter((b) => !b.startsWith('PATCH /v1/classes/{id}'))).toEqual([]);
  });

  it('fails on a removed request field — in the body, or the query', () => {
    const noOrder = edit('POST', '/v1/taps', (r) =>
      parsing(r, 'body', shape(r, 'body').omit({ order: true })),
    );
    expect(broken(today, openApiDocument(noOrder))).toEqual(['POST /v1/taps body.order']);
    const noCursor = edit('GET', '/v1/me/history', (r) =>
      parsing(r, 'query', shape(r, 'query').omit({ before: true })),
    );
    expect(broken(today, openApiDocument(noCursor))).toEqual(['GET /v1/me/history query.before']);
    // A field of a body that may be absent, behind the union that says so.
    const noLeaveId = edit('DELETE', '/v1/enrollments/:id', (r) =>
      parsing(r, 'body', z.object({}).nullish()),
    );
    const leave = broken(today, openApiDocument(noLeaveId));
    expect(leave).toEqual(['DELETE /v1/enrollments/{id} body.eventId']);
    // A rename is a removal: old apps still send the old name.
    const renamed = edit('POST', '/v1/blocks', (r) =>
      parsing(r, 'body', z.object({ tag: z.string() })),
    );
    expect(broken(today, openApiDocument(renamed))).toEqual(['POST /v1/blocks body.tagId']);
  });

  it('passes an addition, and a path parameter renamed', () => {
    const added = edit('POST', '/v1/taps', (r) =>
      parsing(r, 'body', shape(r, 'body').extend({ note: z.string().optional() })),
    );
    const extra: RouteOptions = { method: 'GET', url: '/v1/new', handler: () => ({}) };
    expect(broken(today, openApiDocument([...added, extra]))).toEqual([]);
    // A client sends a path parameter by its place, never its name.
    const byName = edit('POST', '/v1/sessions/:id/refocus', (r) => ({
      ...parsing(r, 'params', z.object({ sessionId: z.uuid() })),
      url: '/v1/sessions/:sessionId/refocus',
    }));
    expect(broken(today, openApiDocument(byName))).toEqual([]);
  });

  it('holds only /v1 to additive-only: the probe and the sweep are not the apps’', () => {
    const without = routes.filter((r) => !r.url.startsWith('/healthz'));
    expect(broken(today, openApiDocument(without))).toEqual([]);
  });
});
