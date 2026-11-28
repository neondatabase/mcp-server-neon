/** Real openid-client requests against a synthetic loopback HTTP issuer, through a fixture-only transport adapter. */
import { createServer, request } from 'node:http';
import { z } from 'zod';
import type { revokeUpstreamTokens } from '../../lib/oauth/client';
import type { Duplex } from 'node:stream';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

type IssuerState = {
  origin: string;
  requests: URLSearchParams[];
  failedHint?: string;
  omitEndpoint: boolean;
  hangDiscovery: boolean;
  hangRevocation: boolean;
};

const issuer: IssuerState = {
  origin: '',
  requests: [],
  omitEndpoint: false,
  hangDiscovery: false,
  hangRevocation: false,
};

const sockets = new Set<Duplex>();

const server = createServer((incoming, outgoing) => {
  outgoing.setHeader('content-type', 'application/json');

  if ((incoming.url ?? '').includes('.well-known')) {
    if (issuer.hangDiscovery) {
      return;
    }

    const metadata = {
      issuer: issuer.origin,
      authorization_endpoint: `${issuer.origin}/authorize`,
      token_endpoint: `${issuer.origin}/token`,
      jwks_uri: `${issuer.origin}/jwks`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      revocation_endpoint: issuer.omitEndpoint
        ? undefined
        : `${issuer.origin}/revoke`,
    };

    outgoing.end(JSON.stringify(metadata));

    return;
  }

  let body = '';
  incoming.setEncoding('utf8');
  incoming.on('data', (chunk: string) => {
    body += chunk;
  });
  incoming.on('end', () => {
    const params = new URLSearchParams(body);
    issuer.requests.push(params);

    if (issuer.hangRevocation) {
      return;
    }

    outgoing.statusCode =
      params.get('token_type_hint') === issuer.failedHint ? 503 : 200;
    outgoing.end(
      outgoing.statusCode === 200
        ? '{}'
        : '{"error":"temporarily_unavailable"}',
    );
  });
});

server.on('connection', (socket) => {
  sockets.add(socket);
  socket.once('close', () => {
    sockets.delete(socket);
  });
});

// The real OAuth library sees a synthetic HTTPS issuer. Only this test adapter
// maps that exact origin to its own loopback HTTP server; no production HTTP
// exception, global TLS bypass or credential-bearing key fixture is installed.
const fixtureFetch: typeof globalThis.fetch = async (input, init) => {
  const req = new Request(input, init);

  if (new URL(req.url).origin !== issuer.origin) {
    throw new Error('Unexpected issuer test destination');
  }

  const body = await req.text();
  const completion = Promise.withResolvers<Response>();

  const target = new URL(req.url);
  target.protocol = 'http:';

  const transport = request(
    target,
    {
      method: req.method,
      headers: Object.fromEntries(req.headers.entries()),
      signal: req.signal,
      agent: false,
    },
    (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      response.on('error', completion.reject);
      response.on('end', () => {
        completion.resolve(
          new Response(Buffer.concat(chunks), {
            status: response.statusCode ?? 500,
            headers: { 'content-type': 'application/json' },
          }),
        );
      });
    },
  );

  transport.on('error', completion.reject);
  transport.end(body);

  return completion.promise;
};

let revokeTokens: typeof revokeUpstreamTokens = async () => {
  throw new Error('Fixture client not initialized');
};

let clock = Date.now();

describe('issuer token retirement protocol', () => {
  beforeAll(async () => {
    const listening = Promise.withResolvers<undefined>();
    server.listen(0, '127.0.0.1', () => {
      listening.resolve(undefined);
    });
    await listening.promise;
    const address = z.object({ port: z.number() }).parse(server.address());
    issuer.origin = `https://127.0.0.1:${address.port}`;
    vi.stubEnv('UPSTREAM_OAUTH_HOST', issuer.origin);
    vi.stubEnv('CLIENT_ID', 'synthetic-client');
    vi.stubEnv('CLIENT_SECRET', 'synthetic-secret');
    vi.stubGlobal('fetch', fixtureFetch);
    vi.useFakeTimers({ toFake: ['Date'] });
    const importedClient = await import('../../lib/oauth/client');

    revokeTokens = importedClient.revokeUpstreamTokens;
  });

  beforeEach(() => {
    clock += 3_600_001;
    vi.setSystemTime(clock);
    issuer.requests = [];
    issuer.failedHint = undefined;
    issuer.omitEndpoint = false;
    issuer.hangDiscovery = false;
    issuer.hangRevocation = false;
  });

  afterAll(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();

    for (const socket of sockets) {
      socket.destroy();
    }

    const closed = Promise.withResolvers<undefined>();
    server.close(() => {
      closed.resolve(undefined);
    });
    await closed.promise;
  });

  const pair = {
    accessToken: 'synthetic-access',
    refreshToken: 'synthetic-refresh',
  };

  it('authenticates both RFC 7009 requests with the configured broker client', async () => {
    await revokeTokens(pair);
    expect(
      issuer.requests.map((params) => Object.fromEntries(params)),
    ).toStrictEqual(
      expect.arrayContaining([
        {
          client_id: 'synthetic-client',
          client_secret: 'synthetic-secret',
          token: 'synthetic-access',
          token_type_hint: 'access_token',
        },
        {
          client_id: 'synthetic-client',
          client_secret: 'synthetic-secret',
          token: 'synthetic-refresh',
          token_type_hint: 'refresh_token',
        },
      ]),
    );
    expect(issuer.requests).toHaveLength(2);
  });

  it.each(['access_token', 'refresh_token'])(
    'attempts the other credential when %s retirement fails',
    async (hint) => {
      issuer.failedHint = hint;
      await expect(revokeTokens(pair)).rejects.toThrow(
        'Issuer token retirement did not complete',
      );
      expect(issuer.requests).toHaveLength(2);
    },
  );

  it('fails closed when discovery has no revocation endpoint', async () => {
    issuer.omitEndpoint = true;
    await expect(revokeTokens(pair)).rejects.toThrow(/.+/u);
    expect(issuer.requests).toHaveLength(0);
  });

  it('cancels discovery and closes its socket on deadline', async () => {
    issuer.hangDiscovery = true;
    await expect(revokeTokens(pair, AbortSignal.timeout(100))).rejects.toThrow(
      /.+/u,
    );
    await expect.poll(() => sockets.size).toBe(0);
    expect(issuer.requests).toHaveLength(0);
  });

  it('cancels both revocation requests and closes their sockets on deadline', async () => {
    issuer.hangRevocation = true;
    await expect(revokeTokens(pair, AbortSignal.timeout(150))).rejects.toThrow(
      /.+/u,
    );
    await expect.poll(() => sockets.size).toBe(0);
    expect(issuer.requests).toHaveLength(2);
  });
});
