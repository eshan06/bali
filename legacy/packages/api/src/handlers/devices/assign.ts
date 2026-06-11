import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { teacherQueries, deviceQueries } from '@bali/db';
import { assignDeviceSchema } from '@bali/shared';
import { AuthUser } from '../../middleware/auth';
import { json, error, notFound } from '../../lib/response';
import { parseBody } from '../../middleware/validate';

export async function handler(event: APIGatewayProxyEventV2, user: AuthUser, params: Record<string, string>) {
  const parsed = parseBody(event, assignDeviceSchema);
  if (parsed.error) return error(parsed.error);

  const teacher = await teacherQueries.findByCognitoSub(user.sub);
  if (!teacher) return error('Teacher not found', 404);

  const device = await deviceQueries.assign(params.deviceId, parsed.data!.studentId);
  if (!device) return notFound('Device not found');

  return json(device);
}
