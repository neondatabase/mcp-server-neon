/**
 * Stubbed-client tests cannot verify the generated helper's wire request or
 * error responses.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Api } from '../neon-client';

type Handlers = typeof import('../tools/tools').NEON_HANDLERS;
type HandleToolError = typeof import('../server/errors').handleToolError;
type NeonApiErrorClass = typeof import('@neon/sdk').NeonApiError;

type RecordedRequest = {
  method: string;
  path: string;
  authorization: string | undefined;
  contentType: string | undefined;
  body: unknown;
};

type Reply = { status: number; body: unknown };

const extra = {
  account: { id: 'acc-1' },
} as unknown as Parameters<Handlers['configure_neon_auth']>[2];

let server: Server;
let recorded: RecordedRequest[];
let replies: Record<string, Reply>;
let neonClient: Api<unknown>;
let NEON_HANDLERS: Handlers;
let handleToolError: HandleToolError;
let NeonApiError: NeonApiErrorClass;

beforeEach(async () => {
  recorded = [];
  replies = {};

  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString();
      recorded.push({
        method: req.method ?? '',
        path: url.pathname,
        authorization: req.headers.authorization,
        contentType: req.headers['content-type'],
        body: raw ? JSON.parse(raw) : undefined,
      });

      const reply = replies[`${req.method} ${url.pathname}`] ?? {
        status: 404,
        body: { message: `no reply configured for ${url.pathname}` },
      };
      res.writeHead(reply.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reply.body));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  // NEON_API_HOST is captured at module load, so set it before importing to
  // keep requests on the local server.
  vi.resetModules();
  process.env.NEON_API_HOST = `http://127.0.0.1:${port}/api/v2`;

  const { createNeonClient } = await import('../neon-client');
  ({ NEON_HANDLERS } = await import('../tools/tools'));
  ({ handleToolError } = await import('../server/errors'));
  ({ NeonApiError } = await import('@neon/sdk'));
  neonClient = createNeonClient('test-api-key');
});

afterEach(async () => {
  delete process.env.NEON_API_HOST;
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

const TEST_PATH =
  'POST /api/v2/projects/proj-1/branches/br-1/auth/email_provider/test';

function sendTestEmail() {
  return NEON_HANDLERS.configure_neon_auth(
    {
      params: {
        operation: 'send_test_email',
        projectId: 'proj-1',
        branchId: 'br-1',
        test_email: { recipient_email: 'tester@example.com' },
      },
    },
    neonClient,
    extra,
  );
}

describe('send_test_email over the wire', () => {
  it('posts recipient_email only to the saved-provider endpoint', async () => {
    replies[TEST_PATH] = {
      status: 200,
      body: { success: true },
    };

    const result = await sendTestEmail();

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toEqual({
      method: 'POST',
      path: '/api/v2/projects/proj-1/branches/br-1/auth/email_provider/test',
      authorization: 'Bearer test-api-key',
      contentType: 'application/json',
      body: { recipient_email: 'tester@example.com' },
    });
    expect(result.isError).toBeFalsy();
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining(
        'Test email dispatched to tester@example.com using the custom SMTP provider saved on this branch.',
      ),
    });
  });

  it('raises a rejected dispatch as a client error the caller can act on', async () => {
    replies[TEST_PATH] = {
      status: 400,
      body: {
        code: 'EMAIL_PROVIDER_NOT_CONFIGURED',
        message: 'no custom email provider is saved on this branch',
      },
    };

    const error = await sendTestEmail().catch((e: unknown) => e);

    if (!(error instanceof NeonApiError)) throw error;
    expect(error.status).toBe(400);
    const handled = handleToolError(error, {});
    expect(handled.isError).toBe(true);
    expect(handled.content.map((part) => part.text)).toContain(
      '[HTTP 400] no custom email provider is saved on this branch',
    );
  });

  it('raises a 5xx as NeonApiError', async () => {
    replies[TEST_PATH] = {
      status: 502,
      body: {
        message: 'email relay unavailable',
      },
    };

    const error = await sendTestEmail().catch((e: unknown) => e);

    if (!(error instanceof NeonApiError)) throw error;
    expect(error.status).toBe(502);
  });
});
