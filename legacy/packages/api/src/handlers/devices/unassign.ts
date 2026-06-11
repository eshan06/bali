import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { teacherQueries, deviceQueries } from '@bali/db';
import { AuthUser } from '../../middleware/auth';
import { json, error, notFound } from '../../lib/response';

export async function handler(event: APIGatewayProxyEventV2, user: AuthUser, params: Record<string, string>) {
  const teacher = await teacherQueries.findByCognitoSub(user.sub);
  if (!teacher) return error('Teacher not found', 404);

  const device = await deviceQueries.unassign(params.deviceId);
  if (!device) return notFound('Device not found');

  return json(device);
}
