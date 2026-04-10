import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { blockingQueries } from '@bali/db';
import { json } from '../../lib/response';

export async function handler(event: APIGatewayProxyEventV2, _user: null, params: Record<string, string>) {
  const policy = await blockingQueries.getPolicyForStudent(params.studentId);

  return json({
    blocking: policy.blocking,
    blockingMode: policy.blockingMode,
    blockedApps: policy.blockedApps,
    allowedApps: policy.allowedApps,
    sessionId: policy.sessionId,
    updatedAt: new Date().toISOString(),
  });
}
