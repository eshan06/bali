import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { teacherQueries, classQueries, sessionQueries, classBlockingConfigQueries } from '@bali/db';
import {
  startSessionSchema,
  resolveBlockingSnapshot,
  type BlockingPreset,
} from '@bali/shared';
import { AuthUser } from '../../middleware/auth';
import { json, error, notFound, conflict } from '../../lib/response';
import { parseBody } from '../../middleware/validate';

export async function handler(event: APIGatewayProxyEventV2, user: AuthUser) {
  const parsed = parseBody(event, startSessionSchema);
  if (parsed.error) return error(parsed.error);

  const teacher = await teacherQueries.findByCognitoSub(user.sub);
  if (!teacher) return error('Teacher not found', 404);

  const cls = await classQueries.findById(parsed.data!.classId);
  if (!cls || cls.teacherId !== teacher.id) return notFound('Class not found');

  const active = await sessionQueries.findActiveByTeacher(teacher.id);
  if (active) return conflict('You already have an active session. End it before starting a new one.');

  // Snapshot the blocking policy at session start so iOS / simulator clients
  // can read a stable policy even if the class config changes mid-session.
  const blockingConfig = await classBlockingConfigQueries.getConfig(cls.id);
  const preset = (blockingConfig?.preset ?? 'none') as BlockingPreset;
  const customApps = (blockingConfig?.customApps ?? []).map((a: any) => ({
    bundleId: a.bundleId as string,
    appName: a.appName as string,
  }));
  const snapshot = resolveBlockingSnapshot(preset, customApps);

  const session = await sessionQueries.start(cls.id, teacher.id, snapshot.mode);
  await sessionQueries.setSnapshot(session.id, snapshot);

  if (snapshot.blockingActive) {
    await sessionQueries.setBlocking(session.id, true, snapshot.mode);
    session.blockingEnabled = true;
    session.blockingMode = snapshot.mode;

    // Keep the legacy session_blocking_apps junction in sync for any read
    // paths that haven't been ported to the snapshot yet (audited in stage 2).
    if (preset === 'custom' && blockingConfig!.customApps.length > 0) {
      const appIds = blockingConfig!.customApps.map((a: any) => a.id);
      await sessionQueries.setBlockingConfig(session.id, snapshot.mode, appIds);
    }
  }

  return json(
    {
      ...session,
      className: cls.name,
      blockingConfigSnapshot: snapshot,
    },
    201
  );
}
