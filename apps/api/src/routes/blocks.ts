import { createBlock, type Database, listBlocks } from '@bali/db';
import type { BlockDetail, BlockListResponse } from '@bali/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireTeacher } from '../auth/teacher.js';
import { ApiError, parseRequest } from '../errors.js';
import { TAG_ID_MAX_LENGTH } from './schemas.js';

const CreateBody = z.object({ tagId: z.string().trim().min(1).max(TAG_ID_MAX_LENGTH) });

type BlockRow = Awaited<ReturnType<typeof listBlocks>>[number];

const toDetail = (block: BlockRow): BlockDetail => ({
  id: block.id,
  tagId: block.tagId,
  createdAt: block.createdAt.toISOString(),
});

/**
 * POST /v1/blocks — a teacher registers a physical NFC tag to themselves. One
 * active block owns a tag at a time, so a tag held by ANOTHER teacher's live
 * block is a 409 (it can be re-registered only after that block is
 * soft-removed). Registering a tag the caller already owns returns their block
 * instead: it is the retry of a lost response, and the response shape is the
 * same BlockDetail either way.
 */
export function registerBlocksRoutes(app: FastifyInstance, db: Database): void {
  app.post(
    '/v1/blocks',
    { preHandler: app.authenticate, config: { parses: { body: CreateBody } } },
    async (request): Promise<BlockDetail> => {
      const teacher = await requireTeacher(db, request);
      const body = parseRequest(request, 'body', CreateBody);
      const result = await createBlock(db, { teacherId: teacher.id, tagId: body.tagId });
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
}
