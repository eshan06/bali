import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { teacherQueries, sessionQueries, blockingQueries } from '@bali/db';
import { setSessionBlocklistSchema } from '@bali/shared';
import { AuthUser } from '../../middleware/auth';
import { json, error, notFound } from '../../lib/response';
import { parseBody } from '../../middleware/validate';

export async function getHandler(event: APIGatewayProxyEventV2, user: AuthUser, params: Record<string, string>) {
  const teacher = await teacherQueries.findByCognitoSub(user.sub);
  if (!teacher) return error('Teacher not found', 404);

  const session = await sessionQueries.findById(params.sessionId);
  if (!session || session.teacherId !== teacher.id) return notFound('Session not found');

  const apps = await blockingQueries.getSessionBlocklist(params.sessionId);
  return json({ apps });
}

export async function setHandler(event: APIGatewayProxyEventV2, user: AuthUser, params: Record<string, string>) {
  const parsed = parseBody(event, setSessionBlocklistSchema);
  if (parsed.error) return error(parsed.error);

  const teacher = await teacherQueries.findByCognitoSub(user.sub);
  if (!teacher) return error('Teacher not found', 404);

  const session = await sessionQueries.findById(params.sessionId);
  if (!session || session.teacherId !== teacher.id) return notFound('Session not found');

  await blockingQueries.setSessionBlocklist(params.sessionId, parsed.data!.appIds);
  const apps = await blockingQueries.getSessionBlocklist(params.sessionId);
  return json({ apps });
}
