/**
 * The authorization-code write retries a dropped Postgres connection once,
 * through the store adapter that wraps Keyv's write failures. A client lookup
 * retries it once when the caller names the operation.
 */
import { once } from 'node:events';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { Effect, Exit, Predicate } from 'effect';
import { afterAll, describe, expect, it } from 'vitest';

// A Postgres stand-in that accepts each connection and drops it at once, the
// way a waking compute does.
const connections = { count: 0 };

const server = createServer((socket) => {
  connections.count += 1;
  socket.destroy();
});

server.listen(0, '127.0.0.1');

await once(server, 'listening');

const address: AddressInfo | string | null = server.address();

if (address === null || Predicate.isString(address)) {
  throw new Error('Postgres stand-in has no TCP address');
}

process.env.OAUTH_DATABASE_URL = `postgresql://127.0.0.1:${address.port}/oauth`;

const { OAuthStore } = await import('../oauth/oauth-store');

describe('OAuthStore connect retry', () => {
  afterAll(async () => {
    server.close();
    await once(server, 'close');
  });

  it('retries saveAuthorizationCode once when the connection drops', async () => {
    const exit = await Effect.runPromiseExit(
      OAuthStore.use((store) =>
        store.saveAuthorizationCode({
          code: {
            authorizationCode: 'connect-retry',
            expiresAt: new Date(Date.now() + 60_000),
            redirectUri: 'http://127.0.0.1:5555/cb',
            scope: ['read'],
            client: { id: 'client', grants: ['authorization_code'] },
            user: { id: 'user' },
          },
        }),
      ).pipe(Effect.provide(OAuthStore.layer)),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(connections.count).toBe(2);
  }, 30_000);

  it('retries findClient once when the caller names the operation', async () => {
    const before = connections.count;

    const exit = await Effect.runPromiseExit(
      OAuthStore.pipe(
        Effect.flatMap((store) =>
          store.findClient({
            clientId: 'connect-retry',
            connectRetryOperation: 'test.getClient',
          }),
        ),
        Effect.provide(OAuthStore.layer),
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(connections.count - before).toBe(2);
  }, 30_000);
});
