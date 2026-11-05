import type { PortalActionRequest, PortalActionResponse, PortalEvent } from '@bali/shared';

import { type ApiClient, SAVE_TIMEOUT_MS } from './api-client';
import { newEventId } from './event-id';

/**
 * Counts one of a teacher's actions (A3b; ARCHITECTURE, "Analytics (PostHog)"): one `POST
 * /v1/me/actions` through the portal's own client, which carries the teacher's token, under a fresh
 * UUIDv7, never awaited and never sent again. Bali's API sends it on to PostHog: the browser talks
 * to no PostHog host. Its caller fires it once the action has happened, for a teacher only (the
 * shell's `CountContext`, read by `useCount`). A failure is swallowed and never said: the count
 * isn't the teacher's action, whose own result and failure the page says as it always has.
 */
export function countAction(api: Pick<ApiClient, 'post'>, event: PortalEvent): void {
  const body: PortalActionRequest = { event, eventId: newEventId() };
  api.post<PortalActionResponse>('/v1/me/actions', body, SAVE_TIMEOUT_MS).catch(() => undefined);
}
