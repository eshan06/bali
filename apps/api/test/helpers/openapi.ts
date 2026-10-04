import type { Database } from '@bali/db';
import { API_VERSION } from '@bali/shared';
import type { RouteOptions } from 'fastify';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z, type ZodType } from 'zod';

import { buildApp } from '../../src/app.js';
import { ENDPOINTS, SCHEMAS } from './contract.js';
import { testEnv } from './env.js';

/*
 * The API snapshot (Phase 4 · O1), for `../openapi.test.ts`: every route the
 * app registers and the request schema each one parses (`config.parses`,
 * which `parseRequest` holds a handler to), as an OpenAPI 3.1 document —
 * with the answer's schema where it is cheap: a student endpoint's, from the
 * contract fixtures' schemas, and the one error shape on every route.
 */

/** Where the snapshot lives, beside the contract fixtures. */
export const SNAPSHOT_FILE = fileURLToPath(
  new URL('../../../../contracts/openapi.json', import.meta.url),
);

type Json = Record<string, unknown>;

/** Every route the app registers, as Fastify shows it to an onRoute hook. */
export async function routeTable(): Promise<RouteOptions[]> {
  const routes: RouteOptions[] = [];
  // Registering a route reads no database, and no request is sent.
  const app = buildApp(testEnv, {
    db: {} as Database,
    verifyToken: () => Promise.reject(new Error('no request is sent')),
    onRoute: (route) => {
      routes.push(route);
    },
  });
  await app.ready();
  await app.close();
  return routes;
}

/**
 * A schema as JSON Schema (draft 2020-12, OpenAPI 3.1's): what a client sends
 * (`input`) or is sent (`output`). A custom check has no JSON Schema, so it is
 * any value — the phone's `order`, which the server takes as none when it
 * cannot use it.
 */
function jsonSchema(schema: ZodType, io: 'input' | 'output'): Json {
  const json: Json = z.toJSONSchema(schema, { io, unrepresentable: 'any' });
  delete json.$schema;
  return json;
}

const json = (schema: ZodType, io: 'input' | 'output') => ({
  'application/json': { schema: jsonSchema(schema, io) },
});

/** A params or query schema as OpenAPI parameters, one per field. */
function parameters(schema: ZodType | undefined, where: 'path' | 'query'): Json[] {
  if (!schema) return [];
  const { properties = {}, required = [] } = jsonSchema(schema, 'input') as {
    properties?: Record<string, Json>;
    required?: string[];
  };
  return Object.entries(properties).map(([name, field]) => ({
    name,
    in: where,
    required: where === 'path' || required.includes(name),
    schema: field,
  }));
}

/** The OpenAPI document of `routes`: what the snapshot holds. */
export function openApiDocument(routes: RouteOptions[]): Json {
  const operations = routes
    .flatMap((route) =>
      [route.method].flat().map((method) => ({
        route,
        method: method.toLowerCase(),
        path: route.url.replace(/:(\w+)/g, '{$1}'),
      })),
    )
    // Fastify answers HEAD beside every GET by itself: not the app's own.
    .filter(({ method }) => method !== 'head')
    .sort((a, b) => (`${a.path} ${a.method}` < `${b.path} ${b.method}` ? -1 : 1));
  const paths: Record<string, Record<string, Json>> = {};
  for (const { route, method, path } of operations) {
    const { params, query, body } = route.config?.parses ?? {};
    const answer = ENDPOINTS[`${method.toUpperCase()} ${path}`];
    (paths[path] ??= {})[method] = {
      ...((params ?? query) && {
        parameters: [...parameters(params, 'path'), ...parameters(query, 'query')],
      }),
      ...(body && {
        requestBody: { required: !body.safeParse(undefined).success, content: json(body, 'input') },
      }),
      responses: {
        200: answer
          ? { description: answer.type, content: json(SCHEMAS[answer.type], 'output') }
          : { description: 'OK' },
        default: { $ref: '#/components/responses/error' },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Bali API',
      version: API_VERSION,
      description:
        'Every route the API serves and the request schema each one parses, generated from the app by `npm run fixtures` (apps/api/test/openapi.test.ts) — never by hand. CI fails on drift, and on any removal from /v1 (additive-only).',
    },
    paths,
    components: {
      responses: {
        error: {
          description: 'The one error shape',
          content: json(SCHEMAS.ApiErrorBody, 'output'),
        },
      },
    },
  };
}

/** The snapshot's file as the generator writes it. */
export const serialize = (doc: Json) => `${JSON.stringify(doc, null, 2)}\n`;

/** The committed snapshot, or null before there is one. */
export async function readSnapshot(file = SNAPSHOT_FILE): Promise<string | null> {
  return readFile(file, 'utf8').catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return null;
    throw err;
  });
}

/** Every field a JSON Schema names, as a dotted path: however deep, in every branch. */
function fields(schema: Json, prefix = ''): string[] {
  const own = Object.entries((schema.properties ?? {}) as Record<string, Json>).flatMap(
    ([name, field]) => [prefix + name, ...fields(field, `${prefix}${name}.`)],
  );
  const branches = ['anyOf', 'oneOf', 'allOf'].flatMap((k) => (schema[k] ?? []) as Json[]);
  const items = schema.items ? fields(schema.items as Json, `${prefix}[].`) : [];
  return [...own, ...branches.flatMap((branch) => fields(branch, prefix)), ...items];
}

interface Operation {
  parameters?: { name: string; in: string }[];
  requestBody?: { content: { 'application/json': { schema: Json } } };
}

/**
 * What a document promises an old app, by key, each with how to name it: every
 * /v1 operation and every field its request sends — a query parameter, or a
 * field of its body. A path parameter is sent by its place, not its name, so
 * the key leaves its name out.
 */
function promises(doc: Json): Map<string, string> {
  const out = new Map<string, string>();
  const paths = (doc.paths ?? {}) as Record<string, Record<string, Operation>>;
  for (const [path, operations] of Object.entries(paths)) {
    if (!path.startsWith('/v1/')) continue;
    for (const [method, operation] of Object.entries(operations)) {
      const name = `${method.toUpperCase()} ${path}`;
      const key = `${method.toUpperCase()} ${path.replace(/\{[^}]*\}/g, '{}')}`;
      out.set(key, name);
      for (const { name: field, in: where } of operation.parameters ?? []) {
        if (where === 'query') out.set(`${key} query.${field}`, `${name} query.${field}`);
      }
      const body = operation.requestBody?.content['application/json'].schema;
      for (const field of body ? fields(body) : []) {
        out.set(`${key} body.${field}`, `${name} body.${field}`);
      }
    }
  }
  return out;
}

/** What `before` promised that `after` no longer does: each one an additive-only failure. */
export function broken(before: Json, after: Json): string[] {
  const kept = promises(after);
  return [...promises(before)].filter(([key]) => !kept.has(key)).map(([, name]) => name);
}

/** The failure for `breaks`, naming the rule it breaks and what to do instead. */
export const additiveOnly = (breaks: string[]) =>
  [
    'Additive-only (CLAUDE.md; docs/ARCHITECTURE.md, API surface decision 2): a shipped /v1',
    'endpoint, method or request field is never removed or renamed — old apps call it forever.',
    'Add a /v2 endpoint beside it instead. Gone from what contracts/openapi.json promises:',
    ...breaks.map((b) => `  ${b}`),
  ].join('\n');
