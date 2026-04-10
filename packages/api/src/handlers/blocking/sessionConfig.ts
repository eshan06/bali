import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { teacherQueries, sessionQueries, studentQueries } from '@bali/db';
import { setSessionBlockingConfigSchema } from '@bali/shared';
import { AuthUser } from '../../middleware/auth';
import { json, error, notFound } from '../../lib/response';
import { parseBody } from '../../middleware/validate';
import { sendBlockingSignal } from '../../services/pushNotification';

export async function getHandler(event: APIGatewayProxyEventV2, user: AuthUser, params: Record<string, string>) {
  const teacher = await teacherQueries.findByCognitoSub(user.sub);
  if (!teacher) return error('Teacher not found', 404);

  const session = await sessionQueries.findById(params.sessionId);
  if (!session || session.teacherId !== teacher.id) return notFound('Session not found');

  const apps = await sessionQueries.getBlockingConfig(params.sessionId);
  return json({
    blockingMode: session.blockingMode,
    apps,
  });
}

export async function setHandler(event: APIGatewayProxyEventV2, user: AuthUser, params: Record<string, string>) {
  const parsed = parseBody(event, setSessionBlockingConfigSchema);
  if (parsed.error) return error(parsed.error);

  const teacher = await teacherQueries.findByCognitoSub(user.sub);
  if (!teacher) return error('Teacher not found', 404);

  const session = await sessionQueries.findById(params.sessionId);
  if (!session || session.teacherId !== teacher.id) return notFound('Session not found');

  await sessionQueries.setBlockingConfig(params.sessionId, parsed.data!.blockingMode, parsed.data!.appIds);

  // Re-send push notification if blocking is currently enabled
  if (session.blockingEnabled) {
    const students = await studentQueries.findByClass(session.classId);
    const studentIds = students.map((s: any) => s.id);
    const apps = await sessionQueries.getBlockingConfig(params.sessionId);
    const bundleIds = apps.map((a: any) => a.bundleId);

    await sendBlockingSignal({
      sessionId: params.sessionId,
      studentIds,
      blockingEnabled: true,
      blockingMode: parsed.data!.blockingMode,
      blockedApps: parsed.data!.blockingMode === 'block_specific' ? bundleIds : [],
      allowedApps: parsed.data!.blockingMode === 'block_all_except' ? bundleIds : [],
    });
  }

  const apps = await sessionQueries.getBlockingConfig(params.sessionId);
  return json({
    blockingMode: parsed.data!.blockingMode,
    apps,
  });
}
