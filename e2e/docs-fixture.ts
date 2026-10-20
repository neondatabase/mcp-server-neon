/**
 * A stand-in for neon.com page markdown, neon-agent's site search, and the
 * feedback service, so the docs tools can be exercised by a merge-gating test
 * without depending on any of them being up.
 *
 * The tools fetch server-side, inside the Next dev server, so Playwright's
 * `request.route()` cannot intercept them; the URLs are swapped instead
 * (`NEON_DOCS_BASE_URL`, `NEON_SITE_SEARCH_URL`, `NEON_FEEDBACK_URL`).
 *
 * The port is fixed rather than ephemeral because the dev server is spawned
 * before `globalSetup` runs, so its environment has to be built in
 * `playwright.config.ts`, where no ephemeral port exists yet. The dev server only
 * fetches when a test calls the tool, which is after `globalSetup`, so starting
 * the fixture second is fine.
 */

import { createServer, type Server } from 'node:http';

const DOCS_FIXTURE_PORT = process.env.E2E_DOCS_PORT ?? '3101';
export const DOCS_FIXTURE_BASE_URL = `http://127.0.0.1:${DOCS_FIXTURE_PORT}`;

// The one page get_doc can read here: the fixture search hit's slug plus `.md`.
const DOCS_FIXTURE_PAGE_PATH = '/docs/reference/glossary.md';

// The same server stands in for the feedback service, so send_feedback can be
// called end to end without sending real feedback. It accepts a POST like the
// real service (204) and only for this path.
const FEEDBACK_FIXTURE_PATH = '/feedback';
export const FEEDBACK_FIXTURE_URL = `http://127.0.0.1:${DOCS_FIXTURE_PORT}${FEEDBACK_FIXTURE_PATH}`;

// The same server stands in for neon-agent's site search behind search_docs.
// The query picks the response, so one URL covers success and each failure.
const SITE_SEARCH_FIXTURE_PATH = '/site-search';
export const SITE_SEARCH_FIXTURE_URL = `http://127.0.0.1:${DOCS_FIXTURE_PORT}${SITE_SEARCH_FIXTURE_PATH}`;

const SITE_SEARCH_FIXTURE_HIT = {
  url: 'https://neon.com/docs/reference/glossary',
  title: 'Glossary',
  slug: 'docs/reference/glossary',
  collection: 'docs',
  category: 'docs',
  breadcrumb: ['Docs'],
  heading: 'Glossary > LSN',
  excerpt:
    'Log Sequence Number. A byte offset to a location in the WAL stream.',
  score: 1.2,
};

const SITE_SEARCH_FIXTURE_RESPONSES: Record<
  string,
  { status: number; body: string }
> = {
  'fixture-empty': { status: 200, body: JSON.stringify({ hits: [] }) },
  'fixture-400': {
    status: 400,
    body: JSON.stringify({ error: 'query must be 500 characters or fewer' }),
  },
  'fixture-500': {
    status: 500,
    body: JSON.stringify({ error: 'Site search failed.' }),
  },
  'fixture-not-json': { status: 200, body: '<html>' },
  'fixture-malformed': { status: 200, body: JSON.stringify({ hits: [null] }) },
};

// `fixture-headers` echoes the caller headers back in the hit excerpt.
function siteSearchResponse(
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
): {
  status: number;
  body: string;
} {
  const request: unknown = JSON.parse(rawBody);
  const query =
    typeof request === 'object' && request !== null && 'query' in request
      ? String(request.query)
      : '';
  if (query === 'fixture-headers') {
    const excerpt = JSON.stringify({
      source: headers['x-neon-source'],
      userAgent: headers['x-neon-user-agent'],
      client: headers['x-neon-client'],
    });
    return {
      status: 200,
      body: JSON.stringify({ hits: [{ ...SITE_SEARCH_FIXTURE_HIT, excerpt }] }),
    };
  }
  return (
    SITE_SEARCH_FIXTURE_RESPONSES[query] ?? {
      status: 200,
      body: JSON.stringify({ hits: [SITE_SEARCH_FIXTURE_HIT] }),
    }
  );
}

/** Marker the e2e assertion matches on. */
export const DOCS_FIXTURE_MARKER = 'E2E_DOCS_PAGE_FIXTURE_MARKER';

const DOCS_FIXTURE_PAGE = `# Glossary\n\n## LSN\n\nLog Sequence Number. ${DOCS_FIXTURE_MARKER}\n`;

/**
 * Serves the fixture page, site search, and feedback paths. Unreferenced on
 * purpose: `scripts/e2e-setup.ts` calls the setup and then expects the process to
 * exit, which an open listener would prevent. It still serves for as long as the
 * process lives, which covers a whole Playwright run.
 */
export async function startDocsFixtureServer(): Promise<Server> {
  const server = createServer((request, response) => {
    if (request.url === DOCS_FIXTURE_PAGE_PATH) {
      response.writeHead(200, {
        'Content-Type': 'text/markdown; charset=utf-8',
      });
      response.end(DOCS_FIXTURE_PAGE);
      return;
    }
    if (request.url === SITE_SEARCH_FIXTURE_PATH && request.method === 'POST') {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const { status, body: responseBody } = siteSearchResponse(
          Buffer.concat(chunks).toString('utf8'),
          request.headers,
        );
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(responseBody);
      });
      return;
    }
    if (request.url === FEEDBACK_FIXTURE_PATH && request.method === 'POST') {
      request.resume();
      request.on('end', () => response.writeHead(204).end());
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
