import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';

/** A refresh request the token endpoint received. */
type HydraRequest = {
  readonly refreshToken: string;
  /** The form body as sent, for its byte length. */
  readonly body: string;
};

/**
 * How the token endpoint answers: a JSON response, a connection closed
 * without one, or no answer at all.
 */
export type HydraAnswer =
  | { readonly kind: 'json'; readonly status: number; readonly body: object }
  | { readonly kind: 'reset' }
  | { readonly kind: 'hang' };

const Address = z.object({ port: z.number() });

const certificate = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hydra-stand-in-'));
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');

  const openssl = spawn(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      key,
      '-out',
      cert,
      '-days',
      '1',
      '-subj',
      '/CN=127.0.0.1',
    ],
    { stdio: 'ignore' },
  );

  await once(openssl, 'exit');

  const pair = { key: await readFile(key), cert: await readFile(cert) };

  await rm(dir, { recursive: true, force: true });

  return pair;
};

/** The request body as UTF-8 text. */
export const readBody = async (request: IncomingMessage) => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.from(z.instanceof(Uint8Array).parse(chunk)));
  }

  return Buffer.concat(chunks).toString('utf8');
};

const respond = (response: ServerResponse, answer: HydraAnswer) => {
  if (answer.kind === 'reset') {
    response.socket?.destroy();

    return;
  }

  if (answer.kind === 'json') {
    response.writeHead(answer.status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(answer.body));
  }
};

const serveDiscovery = (response: ServerResponse, issuer: string) => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(
    JSON.stringify({
      issuer,
      authorization_endpoint: `${issuer}/oauth2/auth`,
      token_endpoint: `${issuer}/oauth2/token`,
      response_types_supported: ['code'],
    }),
  );
};

type Received = {
  readonly requests: HydraRequest[];
  readonly closedUnanswered: string[];
};

const serveToken = async (input: {
  readonly body: string;
  readonly response: ServerResponse;
  readonly received: Received;
  readonly answer: (request: HydraRequest) => Promise<HydraAnswer>;
}) => {
  const { response, received } = input;

  const request = {
    refreshToken: new URLSearchParams(input.body).get('refresh_token') ?? '',
    body: input.body,
  };

  received.requests.push(request);
  response.on('close', () => {
    if (!response.writableEnded) {
      received.closedUnanswered.push(request.refreshToken);
    }
  });
  respond(response, await input.answer(request));
};

/**
 * A local HTTPS stand-in for upstream Hydra: OpenID discovery and the token
 * endpoint, which answers each refresh with `answer`. openid-client refuses a
 * plain-HTTP issuer, so it serves a throwaway self-signed certificate; the
 * process needs `NODE_TLS_REJECT_UNAUTHORIZED=0`. `closedUnanswered` lists the
 * refresh tokens whose connection closed before an answer was sent: a `reset`,
 * or a client that gave up waiting on a `hang`.
 */
export const startHydraStandIn = async (
  answer: (request: HydraRequest) => Promise<HydraAnswer>,
) => {
  const received: Received = { requests: [], closedUnanswered: [] };
  let issuer = '';

  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    const body = await readBody(request);

    if (request.url === '/.well-known/openid-configuration') {
      serveDiscovery(response, issuer);

      return;
    }

    await serveToken({ body, response, received, answer });
  };

  const server = createServer(await certificate(), (request, response) => {
    void handle(request, response);
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  issuer = `https://127.0.0.1:${Address.parse(server.address()).port}`;

  return {
    issuer,
    ...received,
    close: async () => {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    },
  };
};
