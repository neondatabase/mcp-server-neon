import { once } from 'node:events';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { buffer } from 'node:stream/consumers';
import { z } from 'zod';

const Address = z.object({ port: z.number() });

const BODYLESS_METHODS = new Set(['GET', 'HEAD']);

const webRequest = async (origin: string, incoming: IncomingMessage) => {
  const headers = new Headers();

  for (const [name, value] of Object.entries(incoming.headers)) {
    for (const each of [value ?? []].flat()) {
      headers.append(name, each);
    }
  }

  const method = incoming.method ?? 'GET';

  return new Request(new URL(incoming.url ?? '/', origin), {
    method,
    headers,
    body: BODYLESS_METHODS.has(method) ? undefined : await buffer(incoming),
  });
};

const send = async (outgoing: ServerResponse, response: Response) => {
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  outgoing.end(Buffer.from(await response.arrayBuffer()));
};

/**
 * A loopback HTTP server answering each request with `answer`, for the
 * upstream services the server under test reaches by URL.
 */
export const serveLoopback = async (
  answer: (request: Request) => Promise<Response> | Response,
) => {
  const server = createServer();
  let origin = '';

  server.on(
    'request',
    (incoming: IncomingMessage, outgoing: ServerResponse) => {
      void webRequest(origin, incoming)
        .then(answer)
        .then(async (response) => send(outgoing, response));
    },
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  server.unref();
  origin = `http://127.0.0.1:${Address.parse(server.address()).port}`;

  return {
    origin,
    close: async () => {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    },
  };
};

const SegmentEvent = z.object({
  type: z.string(),
  event: z.string().optional(),
  userId: z.string().optional(),
  anonymousId: z.string().optional(),
  properties: z.record(z.string(), z.json()).optional(),
  traits: z.record(z.string(), z.json()).optional(),
  context: z.record(z.string(), z.json()).optional(),
});

const SegmentBatch = z.object({ batch: z.array(SegmentEvent) });

/**
 * A Segment collector: what `answer` receives at `/v1/batch` lands in
 * `delivered`. Point `ANALYTICS_HOST` at the server serving it.
 */
export const segmentCollector = () => {
  const delivered: SegmentEvent[] = [];

  return {
    delivered,
    isBatch: (request: Request) =>
      new URL(request.url).pathname === '/v1/batch',
    answer: async (request: Request) => {
      delivered.push(...SegmentBatch.parse(await request.json()).batch);

      return Response.json({});
    },
  };
};

/**
 * Vercel's request context, collecting what the server hands to `waitUntil`.
 * `settle` waits for all of it, so the analytics, cache writes, and Sentry
 * flushes a request left behind have finished.
 */
export const collectKeepalives = () => {
  const keepalives: Promise<unknown>[] = [];

  Object.defineProperty(globalThis, Symbol.for('@vercel/request-context'), {
    value: {
      get: () => ({
        waitUntil: (promise: Promise<unknown>) => keepalives.push(promise),
      }),
    },
    configurable: true,
  });

  // Settling one keepalive can start another, such as a flush after a write.
  const settle = async (): Promise<void> => {
    if (keepalives.length === 0) {
      return;
    }

    await Promise.all(keepalives.splice(0));
    await settle();
  };

  return { settle };
};
