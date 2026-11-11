/**
 * A stand-in for Sentry ingestion, so e2e tests can assert on the spans and
 * logs the dev server sends, and the suite's deliberate errors never reach
 * production Sentry.
 *
 * The dev server sends envelopes to `SENTRY_FIXTURE_DSN`; tests read what
 * arrived from `GET /items`. The port is fixed for the same reason as the docs
 * fixture: the dev server's environment is built before global setup runs.
 */

import { createServer, type Server } from 'node:http';
import { gunzipSync } from 'node:zlib';

const SENTRY_FIXTURE_PORT = process.env.E2E_SENTRY_PORT ?? '3102';
const SENTRY_FIXTURE_URL = `http://127.0.0.1:${SENTRY_FIXTURE_PORT}`;
export const SENTRY_FIXTURE_DSN = `http://e2e@127.0.0.1:${SENTRY_FIXTURE_PORT}/1`;
export const SENTRY_FIXTURE_ITEMS_URL = `${SENTRY_FIXTURE_URL}/items`;

export type EnvelopeItem = { type: string; payload: unknown };

// An envelope is newline-delimited JSON: the envelope header, then an item
// header and its payload per item. The SDK only sends JSON payloads here.
function parseEnvelope(body: string): EnvelopeItem[] {
  const lines = body.split('\n').filter((line) => line.length > 0);
  const items: EnvelopeItem[] = [];
  for (let i = 1; i + 1 < lines.length; i += 2) {
    const header: unknown = JSON.parse(lines[i]);
    const type =
      typeof header === 'object' && header !== null && 'type' in header
        ? String(header.type)
        : 'unknown';
    items.push({ type, payload: JSON.parse(lines[i + 1]) });
  }
  return items;
}

export async function startSentryFixtureServer(): Promise<Server> {
  const items: EnvelopeItem[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      if (req.method === 'GET' && req.url === '/items') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(items));
        return;
      }
      if (req.method === 'POST' && req.url?.startsWith('/api/1/envelope/')) {
        const raw = Buffer.concat(chunks);
        const body =
          req.headers['content-encoding'] === 'gzip' ? gunzipSync(raw) : raw;
        items.push(...parseEnvelope(body.toString('utf8')));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(SENTRY_FIXTURE_PORT), '127.0.0.1', resolve);
  });
  server.unref();
  return server;
}
