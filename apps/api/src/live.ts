import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SSEMessage } from '@bali/shared';
import { bus } from './bus';
import { getSessionDetail } from './domain';

/**
 * SSE stream for one session. The web client consumes this via fetch-streaming
 * (EventSource can't send Authorization headers); on transport loss it shows the
 * ReconnectingPill and polls GET /v1/sessions/:id every 5s until the stream is back.
 */
export async function streamSession(req: FastifyRequest, reply: FastifyReply, sessionId: string): Promise<void> {
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'access-control-allow-origin': (req.headers.origin as string) ?? '*',
  });
  reply.raw.write(':\n\n'); // open the stream immediately

  const send = (msg: SSEMessage) => {
    reply.raw.write(`data: ${JSON.stringify(msg)}\n\n`);
  };

  // Initial snapshot so the grid renders complete before any delta arrives.
  send({ kind: 'snapshot', detail: await getSessionDetail(sessionId) });

  const unsubscribe = bus.subscribe(sessionId, send);
  const ping = setInterval(() => send({ kind: 'ping', at: new Date().toISOString() }), 15_000);

  const close = () => {
    clearInterval(ping);
    unsubscribe();
    reply.raw.end();
  };
  req.raw.on('close', close);
}
