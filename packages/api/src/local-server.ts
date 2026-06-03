import http from 'http';
import { handler } from './router';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const PORT = process.env.PORT || 3001;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  // Collect body
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const body = Buffer.concat(chunks).toString();

  // Build a mock API Gateway event
  const event: APIGatewayProxyEventV2 = {
    version: '2.0',
    routeKey: `${req.method} ${url.pathname}`,
    rawPath: url.pathname,
    rawQueryString: url.search.slice(1),
    headers: Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v || ''])
    ),
    queryStringParameters: Object.fromEntries(url.searchParams.entries()) || undefined,
    body: body || undefined,
    isBase64Encoded: false,
    requestContext: {
      accountId: 'local',
      apiId: 'local',
      domainName: 'localhost',
      domainPrefix: 'localhost',
      http: {
        method: req.method || 'GET',
        path: url.pathname,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: req.headers['user-agent'] || '',
      },
      requestId: Math.random().toString(36).slice(2),
      routeKey: `${req.method} ${url.pathname}`,
      stage: '$default',
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
  };

  try {
    const result = await handler(event, {} as any);
    const statusCode = typeof result === 'object' && 'statusCode' in result ? result.statusCode || 200 : 200;
    const headers = typeof result === 'object' && 'headers' in result ? result.headers || {} : {};
    const responseBody = typeof result === 'object' && 'body' in result ? result.body : JSON.stringify(result);

    // Dev-only request log (local harness; helps debug on-device requests).
    console.log(`${req.method} ${url.pathname} -> ${statusCode}` +
      (statusCode >= 400 ? ` ${String(responseBody).slice(0, 200)}` : ''));

    Object.entries(headers).forEach(([k, v]) => {
      res.setHeader(k, String(v));
    });
    res.writeHead(statusCode);
    res.end(responseBody);
  } catch (err: any) {
    console.error(`${req.method} ${url.pathname} -> 500`, err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, () => {
  console.log(`Bali API running at http://localhost:${PORT}`);
  console.log(`Database: ${process.env.DATABASE_URL ? 'configured' : 'NOT configured — set DATABASE_URL in .env'}`);
  console.log(`Cognito: ${process.env.COGNITO_USER_POOL_ID ? 'configured' : 'NOT configured — set COGNITO_USER_POOL_ID in .env'}`);
});
