import { ZodSchema } from 'zod';
import { APIGatewayProxyEventV2 } from 'aws-lambda';

export function parseBody<T>(event: APIGatewayProxyEventV2, schema: ZodSchema<T>): { data?: T; error?: string } {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const result = schema.safeParse(body);
    if (!result.success) {
      const messages = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return { error: messages.join('; ') };
    }
    return { data: result.data };
  } catch {
    return { error: 'Invalid JSON body' };
  }
}
