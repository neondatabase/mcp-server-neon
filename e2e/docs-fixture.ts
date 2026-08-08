/**
 * A stand-in for the Neon docs index, so the docs tools can be exercised by a
 * merge-gating test without depending on neon.com being up.
 *
 * `listDocsResources` fetches server-side, inside the Next dev server, so
 * Playwright's `request.route()` cannot intercept it — the URL has to be swapped
 * instead, which is what `NEON_DOCS_INDEX_URL` is for.
 *
 * The port is fixed rather than ephemeral because the dev server is spawned
 * before `globalSetup` runs, so its environment has to be built in
 * `playwright.config.ts`, where no ephemeral port exists yet. The dev server only
 * fetches when a test calls the tool, which is after `globalSetup`, so starting
 * the fixture second is fine.
 */

import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';

const DOCS_FIXTURE_PORT = process.env.E2E_DOCS_PORT ?? '3101';
const DOCS_FIXTURE_PATH = '/docs/llms.txt';
export const DOCS_FIXTURE_INDEX_URL = `http://127.0.0.1:${DOCS_FIXTURE_PORT}${DOCS_FIXTURE_PATH}`;

/** Marker the e2e assertion matches on. Also present in the fixture file. */
export const DOCS_FIXTURE_MARKER = 'E2E_DOCS_INDEX_FIXTURE_MARKER';

const FIXTURE_FILE = path.resolve(
  import.meta.dirname,
  'fixtures',
  'docs-index.txt',
);

/**
 * Serves the fixture at the one path the docs index is read from. Unreferenced on
 * purpose: `scripts/e2e-setup.ts` calls the setup and then expects the process to
 * exit, which an open listener would prevent. It still serves for as long as the
 * process lives, which covers a whole Playwright run.
 */
export async function startDocsFixtureServer(): Promise<Server> {
  const body = readFileSync(FIXTURE_FILE);
  const server = createServer((request, response) => {
    if (request.url === DOCS_FIXTURE_PATH) {
      response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(body);
      return;
    }
    response.writeHead(404).end();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(DOCS_FIXTURE_PORT), '127.0.0.1', resolve);
  });
  server.unref();
  return server;
}
