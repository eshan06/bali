import { APIGatewayProxyResultV2 } from 'aws-lambda';

const corsHeaders = {
  'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
};

export function json(data: any, statusCode = 200): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
    body: JSON.stringify(data),
  };
}

export function error(message: string, statusCode = 400): APIGatewayProxyResultV2 {
  return json({ error: message }, statusCode);
}

export function notFound(message = 'Not found'): APIGatewayProxyResultV2 {
  return error(message, 404);
}

export function unauthorized(message = 'Unauthorized'): APIGatewayProxyResultV2 {
  return error(message, 401);
}

export function conflict(message: string): APIGatewayProxyResultV2 {
  return error(message, 409);
}

export function corsResponse(): APIGatewayProxyResultV2 {
  return { statusCode: 204, headers: corsHeaders, body: '' };
}
