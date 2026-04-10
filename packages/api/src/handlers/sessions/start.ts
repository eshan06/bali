import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { teacherQueries, classQueries, sessionQueries, classBlockingConfigQueries } from '@bali/db';
import { startSessionSchema } from '@bali/shared';
import { AuthUser } from '../../middleware/auth';
import { json, error, notFound, conflict } from '../../lib/response';
import { parseBody } from '../../middleware/validate';

export async function handler(event: APIGatewayProxyEventV2, user: AuthUser) {
  const parsed = parseBody(event, startSessionSchema);
  if (parsed.error) return error(parsed.error);

  const teacher = await teacherQueries.findByCognitoSub(user.sub);
  if (!teacher) return error('Teacher not found', 404);

  // Check class ownership
  const cls = await classQueries.findById(parsed.data!.classId);
  if (!cls || cls.teacherId !== teacher.id) return notFound('Class not found');

  // Enforce one active session per teacher
  const active = await sessionQueries.findActiveByTeacher(teacher.id);
  if (active) return conflict('You already have an active session. End it before starting a new one.');

  // Get class blocking config
  const blockingConfig = await classBlockingConfigQueries.getConfig(cls.id);
  const hasBlocking = blockingConfig && blockingConfig.preset !== 'none';

  // Determine blocking mode from preset
  let blockingMode = 'block_specific';
  if (blockingConfig?.preset === 'full_focus') {
    blockingMode = 'block_all_except';
  }

  const session = await sessionQueries.start(cls.id, teacher.id, blockingMode);

  // Auto-enable blocking if class has a blocking config
  if (hasBlocking) {
    await sessionQueries.setBlocking(session.id, true, blockingMode);
    session.blockingEnabled = true;
    session.blockingMode = blockingMode;

    // Copy class custom apps to session if custom preset
    if (blockingConfig!.preset === 'custom' && blockingConfig!.customApps.length > 0) {
      const appIds = blockingConfig!.customApps.map((a: any) => a.id);
      await sessionQueries.setBlockingConfig(session.id, blockingMode, appIds);
    }
  }

  return json({ ...session, className: cls.name }, 201);
}
