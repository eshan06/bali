import { createBlock, type Database, findBlock, listBlocks, removeBlock } from '@bali/db';
import type { BlockDetail, BlockListResponse, RemoveBlockResponse } from '@bali/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireTeacher } from '../auth/teacher.js';
import { ApiError, parseRequest } from '../errors.js';
import { mapTransitionError } from './errors.js';
import { TAG_ID_MAX_LENGTH } from './schemas.js';

const CreateBody = z.object({ tagId: z.string().trim().min(1).max(TAG_ID_MAX_LENGTH) });
const Params = z.object({ id: z.string().uuid() });
const RemoveBody = z.object({ eventId: z.uuidv7() });

type BlockRow = Awaited<ReturnType<typeof listBlocks>>[number];

const toDetail = (block: BlockRow): BlockDetail => ({
  id: block.id,
  tagId: block.tagId,
  createdAt: block.createdAt.toISOString(),
});

/** No block has that id: the removal's one 404. */
const blockNotFound = () => ApiError.notFound('block not found');

/**
 * POST /v1/blocks — a teacher registers a physical NFC tag to themselves. One
 * active block owns a tag at a time, so a tag held by ANOTHER teacher's live
 * block is a 409 (it can be re-registered only after that block is
 * soft-removed). Registering a tag the caller already owns returns their block
 * instead: it is the retry of a lost response, and the response shape is the
 * same BlockDetail either way.
 */
export function registerBlocksRoutes(app: FastifyInstance, db: Database, clock: () => Date): void {
  app.post(
    '/v1/blocks',
    { preHandler: app.authenticate, config: { parses: { body: CreateBody } } },
    async (request): Promise<BlockDetail> => {
      const teacher = await requireTeacher(db, request);
      const body = parseRequest(request, 'body', CreateBody);
      // A teacher deleted while this was on its way (C3) is `409 account_deleted`.
      const result = await mapTransitionError(() =>
        createBlock(db, { teacherId: teacher.id, tagId: body.tagId }),
      );
      if (result.outcome === 'tag_taken') {
        throw ApiError.conflict('that tag is already registered to an active block');
      }
      return toDetail(result.block);
    },
  );

  /**
   * GET /v1/blocks — the caller's own live blocks, oldest first (Phase 5 ·
   * P3): what the portal shows beside the field that registers one. Never
   * another teacher's, and a student has none to read (403).
   */
  app.get(
    '/v1/blocks',
    { preHandler: app.authenticate },
    async (request): Promise<BlockListResponse> => {
      const teacher = await requireTeacher(db, request);
      return { blocks: (await listBlocks(db, teacher.id)).map(toDetail) };
    },
  );

  /**
   * DELETE /v1/blocks/:id — a teacher removes one of their own blocks, a lost
   * one (LO10b), its tag free from then on for anyone to register again (the
   * owner's "Free the code", 2026-11-17). The body is `{ eventId }`, a UUIDv7
   * the removal is idempotent on: a block removed already is answered `replay`,
   * the block as it is. Another teacher's block, removed or not, is 403; no
   * block with the id, 404; an id another block's removal holds, `409
   * event_id_conflict`. A session of the teacher's running is no refusal: it is
   * its class's, never its block's, and runs on to its bell.
   */
  app.delete(
    '/v1/blocks/:id',
    { preHandler: app.authenticate, config: { parses: { params: Params, body: RemoveBody } } },
    async (request): Promise<RemoveBlockResponse> => {
      const { id } = parseRequest(request, 'params', Params);
      const teacher = await requireTeacher(db, request);
      // A removed one is read too, for its removal's retry. Never moved: a block keeps its teacher.
      const found = await findBlock(db, id);
      if (!found) throw blockNotFound();
      if (found.teacherId !== teacher.id) throw ApiError.forbidden('not your block');
      const { eventId } = parseRequest(request, 'body', RemoveBody);
      const result = await mapTransitionError(() =>
        removeBlock(db, { blockId: id, eventId, now: clock() }),
      );
      if (result.outcome === 'block_not_found') throw blockNotFound();
      return { outcome: result.outcome, block: toDetail(result.block) };
    },
  );
}
