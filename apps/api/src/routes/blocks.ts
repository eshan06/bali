import { createBlock, type Database } from '@bali/db';
import type { BlockDetail } from '@bali/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireTeacher } from '../auth/teacher.js';
import { ApiError, parse } from '../errors.js';

const CreateBody = z.object({ tagId: z.string().trim().min(1).max(200) });

/**
 * POST /v1/blocks — a teacher registers a physical NFC tag to themselves. One
 * active block owns a tag at a time, so a tag already held by a live block is a
 * 409 (the same tag can be re-registered only after its block is soft-removed).
 */
export function registerBlocksRoutes(app: FastifyInstance, db: Database): void {
  app.post(
    '/v1/blocks',
    { preHandler: app.authenticate },
    async (request): Promise<BlockDetail> => {
      const teacher = await requireTeacher(db, request);
      const body = parse(CreateBody, request.body);
      const result = await createBlock(db, { teacherId: teacher.id, tagId: body.tagId });
      if (result.outcome === 'tag_taken') {
        throw ApiError.conflict('that tag is already registered to an active block');
      }
      return {
        id: result.block.id,
        tagId: result.block.tagId,
        createdAt: result.block.createdAt.toISOString(),
      };
    },
  );
}
