import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { teacherQueries, deviceQueries } from '@bali/db';
import { registerDeviceSchema } from '@bali/shared';
import { AuthUser } from '../../middleware/auth';
import { json, error } from '../../lib/response';
import { parseBody } from '../../middleware/validate';

export async function handler(event: APIGatewayProxyEventV2, user: AuthUser) {
  const parsed = parseBody(event, registerDeviceSchema);
  if (parsed.error) return error(parsed.error);

  const teacher = await teacherQueries.findByCognitoSub(user.sub);
  if (!teacher) return error('Teacher not found', 404);

  try {
    const device = await deviceQueries.register(
      teacher.schoolId, parsed.data!.deviceId, parsed.data!.friendlyName
    );
    return json(device, 201);
  } catch (err: any) {
    if (err.message?.includes('unique') || err.code === '23505') {
      return error('Device already registered', 409);
    }
    throw err;
  }
}
