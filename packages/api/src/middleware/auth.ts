import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { APIGatewayProxyEventV2 } from 'aws-lambda';

export interface AuthUser {
  sub: string;
  email: string;
  name: string;
}

let verifier: ReturnType<typeof CognitoJwtVerifier.create> | null = null;

function getVerifier() {
  if (!verifier) {
    verifier = CognitoJwtVerifier.create({
      userPoolId: process.env.COGNITO_USER_POOL_ID!,
      tokenUse: 'id',
      clientId: process.env.COGNITO_CLIENT_ID!,
    });
  }
  return verifier;
}

export async function authenticateJwt(event: APIGatewayProxyEventV2): Promise<AuthUser | null> {
  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  if (!authHeader) return null;

  const token = authHeader.replace('Bearer ', '');
  if (!token) return null;

  try {
    const payload = await getVerifier().verify(token);
    return {
      sub: payload.sub,
      email: (payload.email as string) || '',
      name: (payload.name as string) || (payload.email as string) || 'Teacher',
    };
  } catch {
    return null;
  }
}

export function authenticateApiKey(event: APIGatewayProxyEventV2): boolean {
  const apiKey = event.headers?.['x-api-key'] || event.headers?.['X-API-Key'];
  return apiKey === process.env.API_KEY;
}
