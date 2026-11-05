import type { Database } from '@bali/db';
import { PORTAL_EVENTS, type PortalActionResponse } from '@bali/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { Analytics } from '../analytics.js';
import { requireTeacher } from '../auth/teacher.js';
import { parseRequest } from '../errors.js';
import type { Limiter } from '../limits.js';

/** The action's name and its id: nothing else a body carries is read, let alone sent on. */
const ActionBody = z.object({ event: z.enum(PORTAL_EVENTS), eventId: z.uuidv7() });

/**
 * POST /v1/me/actions — the portal counts one of its teacher's actions (A3a; ARCHITECTURE,
 * "Analytics (PostHog)"): forwarded to PostHog with the server's key, so the browser holds no key
 * and talks to no PostHog host. Teachers only: anyone else `403`, a name not in `PORTAL_EVENTS` or
 * an id that is no UUIDv7 `400`, past the teacher's budget `429` (`portalActions`), each sending
 * nothing. The server builds the event itself (`Analytics.action`): the caller by Bali's id, the
 * server's clock, `environment`, and of the body the name alone, with `eventId` as PostHog's
 * `uuid`, so no id, URL or text a client writes reaches PostHog. Answered `{}` before the send,
 * which never fails it, and the same whether PostHog is on or off: the relay keeps no row, so a
 * resend is answered as the first was and is sent again, for PostHog's best-effort drop.
 */
export function registerActionsRoute(
  app: FastifyInstance,
  db: Database,
  limits: Limiter,
  analytics: Analytics,
): void {
  app.post(
    '/v1/me/actions',
    { preHandler: app.authenticate, config: { parses: { body: ActionBody } } },
    async (request): Promise<PortalActionResponse> => {
      const teacher = await requireTeacher(db, request);
      const { event, eventId } = parseRequest(request, 'body', ActionBody);
      limits.portalAction(teacher.id);
      analytics.action(event, teacher.id, eventId);
      return {};
    },
  );
}
