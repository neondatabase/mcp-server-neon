/**
 * `NeonAccounts` against a local Neon API: what each operation sends, what it
 * returns, which failures keep its span ok, and that interrupting a call
 * closes its request.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { once } from 'node:events';
import { getClient, init, spanToJSON } from '@sentry/node';
import { Effect, Exit, Fiber, Redacted } from 'effect';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import pkg from '../../package.json';

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

type Received = { path: string; userAgent?: string; authorization?: string };

const received: Received[] = [];

const hangingRequest = {
  reached: Promise.withResolvers<true>(),
  closed: Promise.withResolvers<true>(),
};

const json = (res: ServerResponse, status: number, body: Json) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const ROUTES = new Map<string, [number, Json]>([
  [
    'key-user /users/me',
    [
      200,
      { id: 'user-1', name: 'Ada', last_name: 'L', email: 'ada@example.com' },
    ],
  ],
  [
    'key-org /organizations/org-1',
    [200, { id: 'org-1', name: 'Acme', handle: 'acme' }],
  ],
  [
    'key-project /users/me',
    [
      403,
      {
        message:
          'This API key is scoped to a project and cannot access resources outside the project',
      },
    ],
  ],
  ['key-rejected /auth', [401, { message: 'authentication failed' }]],
  [
    'key-user /auth',
    [200, { auth_method: 'api_key_user', account_id: 'user-1' }],
  ],
  [
    'key-many /users/me/organizations',
    [
      200,
      {
        organizations: [
          { id: 'org-a', name: 'A', handle: 'a', managed_by: 'console' },
          { id: 'org-b', name: 'B', handle: 'b', managed_by: 'console' },
        ],
      },
    ],
  ],
]);

const answerApi = (req: IncomingMessage, res: ServerResponse) => {
  const [path = ''] = (req.url ?? '').replace(/^\/api\/v2/u, '').split('?');
  const key = (req.headers.authorization ?? '').replace(/^Bearer /u, '');

  received.push({
    path,
    userAgent: req.headers['user-agent'],
    authorization: req.headers.authorization,
  });

  if (key === 'key-hang') {
    hangingRequest.reached.resolve(true);
    req.on('close', () => {
      hangingRequest.closed.resolve(true);
    });

    return;
  }

  const [status, body] = ROUTES.get(`${key} ${path}`) ?? [
    404,
    { message: `no fake for ${path}` },
  ];

  json(res, status, body);
};

const api = createServer(answerApi);

api.listen(0, '127.0.0.1');

await once(api, 'listening');

const { port } = z.object({ port: z.number() }).parse(api.address());

process.env.NEON_API_HOST = `http://127.0.0.1:${port}/api/v2`;

init({ dsn: 'http://public@127.0.0.1:1/1', tracesSampleRate: 1 });

type EndedSpan = {
  status: string;
  data: ReturnType<typeof spanToJSON>['data'];
};

const spans = new Map<string, EndedSpan>();

getClient()?.on('spanEnd', (span) => {
  const { description, status, data } = spanToJSON(span);

  if (description?.startsWith('NeonAccounts.') === true) {
    spans.set(description, { status: status ?? 'unset', data });
  }
});

const { mcpRuntime } = await import('../../lib/effect/runtime');
const { NeonAccounts } = await import('../server/neon-accounts');

type Accounts = Effect.Success<typeof NeonAccounts.make>;

const run = async <A, E>(
  operation: (accounts: Accounts) => Effect.Effect<A, E>,
) =>
  mcpRuntime.runPromiseExit(
    Effect.gen(function* () {
      const accounts = yield* NeonAccounts;

      return yield* operation(accounts);
    }),
  );

const apiKey = (key: string) => Redacted.make(key);

describe('NeonAccounts', () => {
  beforeEach(() => {
    received.length = 0;
    spans.clear();
  });

  afterAll(() => {
    api.close();
  });

  it('reads auth details with the key and the server User-Agent', async () => {
    const exit = await run((accounts) =>
      accounts.authDetails({ apiKey: apiKey('key-user') }),
    );

    expect(exit).toStrictEqual(
      Exit.succeed({ auth_method: 'api_key_user', account_id: 'user-1' }),
    );
    expect(received).toStrictEqual([
      {
        path: '/auth',
        userAgent: `mcp-server-neon/${pkg.version}`,
        authorization: 'Bearer key-user',
      },
    ]);
  });

  it('resolves a personal key to its user and an org key to its org', async () => {
    const user = await run((accounts) =>
      accounts.account({
        apiKey: apiKey('key-user'),
        auth: { auth_method: 'api_key_user', account_id: 'user-1' },
      }),
    );

    const org = await run((accounts) =>
      accounts.account({
        apiKey: apiKey('key-org'),
        auth: { auth_method: 'api_key_org', account_id: 'org-1' },
      }),
    );

    expect(user).toStrictEqual(
      Exit.succeed({
        id: 'user-1',
        name: 'Ada L',
        email: 'ada@example.com',
        isOrg: false,
      }),
    );
    expect(org).toStrictEqual(
      Exit.succeed({ id: 'org-1', name: 'Acme', isOrg: true }),
    );
  });

  it('falls back to a placeholder account for a project-scoped key', async () => {
    const exit = await run((accounts) =>
      accounts.account({
        apiKey: apiKey('key-project'),
        auth: { auth_method: 'api_key_user', account_id: 'user-9' },
      }),
    );

    expect(exit).toStrictEqual(
      Exit.succeed({
        id: 'user-9',
        name: 'Project-scoped API Key',
        isOrg: false,
      }),
    );
    expect(spans.get('NeonAccounts.account')).toMatchObject({
      status: 'ok',
      data: { 'neon.account.project_scoped_key': true },
    });
  });

  it('keeps the span ok for a key Neon rejects and records the error type', async () => {
    const exit = await run((accounts) =>
      accounts.authDetails({ apiKey: apiKey('key-rejected') }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(spans.get('NeonAccounts.authDetails')).toMatchObject({
      status: 'ok',
      data: { 'error.type': 'NeonAuthError' },
    });
    expect(JSON.stringify([...spans.values()])).not.toContain('key-rejected');
  });

  it('uses an explicit org_id or an org key without asking Neon', async () => {
    const explicit = await run((accounts) =>
      accounts.organization({
        apiKey: apiKey('key-user'),
        account: { id: 'user-1' },
        orgId: 'org-explicit',
      }),
    );

    const orgKey = await run((accounts) =>
      accounts.organization({
        apiKey: apiKey('key-org'),
        account: { id: 'org-1', isOrg: true },
        orgId: undefined,
      }),
    );

    expect(explicit).toStrictEqual(Exit.succeed({ id: 'org-explicit' }));
    expect(orgKey).toStrictEqual(Exit.succeed({ id: 'org-1' }));
    expect(received).toStrictEqual([]);
  });

  it('fails with NoDefaultOrganization inside an ok span when the account has several', async () => {
    const exit = await run((accounts) =>
      accounts
        .organization({
          apiKey: apiKey('key-many'),
          account: { id: 'user-1' },
          orgId: undefined,
        })
        .pipe(
          Effect.flip,
          Effect.map(({ _tag }) => _tag),
        ),
    );

    expect(exit).toStrictEqual(Exit.succeed('NoDefaultOrganization'));
    expect(spans.get('NeonAccounts.organization')).toMatchObject({
      status: 'ok',
      data: { 'error.type': 'NoDefaultOrganization' },
    });
  });

  it('closes the request when the call is interrupted', async () => {
    const fiber = mcpRuntime.runFork(
      Effect.gen(function* () {
        const accounts = yield* NeonAccounts;

        return yield* accounts.authDetails({ apiKey: apiKey('key-hang') });
      }),
    );

    await hangingRequest.reached.promise;
    await mcpRuntime.runPromise(Fiber.interrupt(fiber));

    await expect(hangingRequest.closed.promise).resolves.toBe(true);
  });
});
