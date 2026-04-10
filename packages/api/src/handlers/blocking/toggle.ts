import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { teacherQueries, sessionQueries, studentQueries, teacherBlockingDefaultQueries } from '@bali/db';
import { toggleBlockingSchema } from '@bali/shared';
import { AuthUser } from '../../middleware/auth';
import { json, error, notFound } from '../../lib/response';
import { parseBody } from '../../middleware/validate';
import { sendBlockingSignal } from '../../services/pushNotification';

export async function handler(event: APIGatewayProxyEventV2, user: AuthUser, params: Record<string, string>) {
  const parsed = parseBody(event, toggleBlockingSchema);
  if (parsed.error) return error(parsed.error);

  const teacher = await teacherQueries.findByCognitoSub(user.sub);
  if (!teacher) return error('Teacher not found', 404);

  const session = await sessionQueries.findById(params.sessionId);
  if (!session || session.teacherId !== teacher.id) return notFound('Session not found');

  const blockingMode = parsed.data!.blockingMode || session.blockingMode || 'block_specific';

  await sessionQueries.setBlocking(params.sessionId, parsed.data!.enabled, blockingMode);

  // If enabling with app config, set the session blocking apps
  if (parsed.data!.enabled && parsed.data!.appIds) {
    await sessionQueries.setBlockingConfig(params.sessionId, blockingMode, parsed.data!.appIds);
  }
  // If enabling without config and no apps configured yet, seed from teacher defaults
  else if (parsed.data!.enabled) {
    const existingApps = await sessionQueries.getBlockingConfig(params.sessionId);
    if (existingApps.length === 0) {
      const defaults = await teacherBlockingDefaultQueries.get(teacher.id);
      if (defaults && defaults.appIds.length > 0) {
        await sessionQueries.setBlockingConfig(params.sessionId, defaults.blockingMode, defaults.appIds);
      }
    }
  }

  // Send blocking signal to student devices
  const students = await studentQueries.findByClass(session.classId);
  const studentIds = students.map((s: any) => s.id);

  let blockedApps: string[] = [];
  let allowedApps: string[] = [];

  if (parsed.data!.enabled) {
    const configApps = await sessionQueries.getBlockingConfig(params.sessionId);
    const bundleIds = configApps.map((a: any) => a.bundleId);

    if (blockingMode === 'block_all_except') {
      allowedApps = bundleIds;
    } else {
      blockedApps = bundleIds;
    }
  }

  await sendBlockingSignal({
    sessionId: params.sessionId,
    studentIds,
    blockingEnabled: parsed.data!.enabled,
    blockingMode,
    blockedApps,
    allowedApps,
  });

  return json({ sessionId: params.sessionId, blockingEnabled: parsed.data!.enabled, blockingMode });
}
