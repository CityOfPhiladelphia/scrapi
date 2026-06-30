import { config } from 'dotenv';
config();

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { mkdirSync } from 'node:fs';
import { main } from './index.js';
import type { APIGWV1Payload } from '@phila/philaroute/dist/aws.d.ts';
import { USJS_PDF_PATH } from './consts.js';

// Ensure tmp download directory exists
mkdirSync(USJS_PDF_PATH, { recursive: true });

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString();
      resolve(body.length > 0 ? body : null);
    });
    req.on('error', reject);
  });
}

function parseQueryString(url: string): Record<string, string> | null {
  const idx = url.indexOf('?');
  if (idx === -1) return null;
  const params: Record<string, string> = {};
  new URLSearchParams(url.slice(idx + 1)).forEach((v, k) => { params[k] = v; });
  return Object.keys(params).length > 0 ? params : null;
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const rawUrl = req.url ?? '/';
  const path = rawUrl.split('?')[0];
  const method = (req.method ?? 'GET').toUpperCase();
  const headers = req.headers as Record<string, string>;
  const qs = parseQueryString(rawUrl);
  const body = await readBody(req);

  const event: APIGWV1Payload = {
    version: '1.0',
    resource: path,
    path,
    httpMethod: method,
    headers,
    multiValueHeaders: {},
    queryStringParameters: qs,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    body,
    isBase64Encoded: false,
    requestContext: {
      accountId: 'local',
      apiId: 'local',
      authorizer: { claims: null, scopes: null },
      domainName: 'localhost',
      domainPrefix: 'localhost',
      extendedRequestId: `local-${Date.now()}`,
      httpMethod: method,
      identity: {
        accessKey: null, accountId: null, caller: null,
        cognitoAuthenticationProvider: null, cognitoAuthenticationType: null,
        cognitoIdentityId: null, cognitoIdentityPoolId: null,
        principalOrgId: null, sourceIp: '127.0.0.1',
        user: null, userAgent: headers['user-agent'] ?? 'local',
        userArn: null,
      },
      path,
      protocol: 'HTTP/1.1',
      requestId: `local-${Date.now()}`,
      requestTime: new Date().toISOString(),
      requestTimeEpoch: Date.now(),
      resourceId: null,
      resourcePath: path,
      stage: 'local',
    },
  };

  try {
    const result = await main(event);
    const statusCode = result.statusCode ?? 200;
    const responseBody = typeof result.body === 'string'
      ? result.body
      : JSON.stringify(result.body);

    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      ...result.headers,
    });
    res.end(responseBody);
  } catch (err) {
    console.error('Handler error:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err) }));
  }
});

server.listen(PORT, () => {
  console.log(`Local server running on http://localhost:${PORT}`);
  console.log(`LOCAL=${process.env.LOCAL}, PDF path: ${USJS_PDF_PATH}`);
  console.log('');
  console.log('Example requests:');
  console.log(`  curl "http://localhost:${PORT}/usjs/v1/summary?docketNum=MC-51-CR-1234567-2023"`);
  console.log(`  curl "http://localhost:${PORT}/usjs/v1/docket?docketNum=MC-51-CR-1234567-2023"`);
  console.log(`  curl "http://localhost:${PORT}/usjs/v1/person?firstName=Jane&lastName=Doe&dob=1990-01-01"`);
});
