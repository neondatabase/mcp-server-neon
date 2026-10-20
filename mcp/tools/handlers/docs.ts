import { NEON_DOCS_INDEX_URL, NEON_SITE_SEARCH_URL } from '../../../lib/config';
import { NEON_DOCS_BASE_URL } from '../../resources';
import { InvalidArgumentError, NotFoundError } from '../../server/errors';

// Hard cap on upstream docs fetches so a stalled neon.com response
// cannot hold a Vercel concurrency slot for the full 800s function
// duration. The docs-only endpoint is anonymous, so this is a reachable
// vector without authentication.
const DOCS_FETCH_TIMEOUT_MS = 10_000;

type SearchDocsHit = {
  title: string;
  url: string;
  slug: string;
  category: string;
  breadcrumb: string[];
  heading: string;
  excerpt: string;
};

const UNEXPECTED_SEARCH_RESPONSE =
  'Neon site search returned an unexpected response';

function stringField(fields: Record<string, unknown>, key: string): string {
  const value = fields[key];
  if (typeof value !== 'string') {
    throw new Error(
      `${UNEXPECTED_SEARCH_RESPONSE}: hit.${key} is not a string`,
    );
  }
  return value;
}

function parseSearchHits(body: unknown): SearchDocsHit[] {
  if (
    typeof body !== 'object' ||
    body === null ||
    !('hits' in body) ||
    !Array.isArray(body.hits)
  ) {
    throw new Error(`${UNEXPECTED_SEARCH_RESPONSE}: missing hits`);
  }
  return body.hits.map((hit: unknown): SearchDocsHit => {
    if (typeof hit !== 'object' || hit === null) {
      throw new Error(`${UNEXPECTED_SEARCH_RESPONSE}: hit is not an object`);
    }
    const fields: Record<string, unknown> = Object.fromEntries(
      Object.entries(hit),
    );
    const breadcrumb = fields.breadcrumb;
    if (
      !Array.isArray(breadcrumb) ||
      !breadcrumb.every((part) => typeof part === 'string')
    ) {
      throw new Error(
        `${UNEXPECTED_SEARCH_RESPONSE}: hit.breadcrumb is not a string array`,
      );
    }
    return {
      title: stringField(fields, 'title'),
      url: stringField(fields, 'url'),
      slug: stringField(fields, 'slug'),
      category: stringField(fields, 'category'),
      breadcrumb,
      heading: stringField(fields, 'heading'),
      excerpt: stringField(fields, 'excerpt'),
    };
  });
}

function upstreamError(body: unknown): string | undefined {
  if (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof body.error === 'string' &&
    body.error.trim() !== ''
  ) {
    return body.error;
  }
  return undefined;
}

export async function searchDocs(params: {
  query: string;
  categories?: string[];
  limit: number;
}): Promise<string> {
  const response = await fetch(NEON_SITE_SEARCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(DOCS_FETCH_TIMEOUT_MS),
  });
  const raw = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Error(
      `${UNEXPECTED_SEARCH_RESPONSE}: HTTP ${response.status}, body is not JSON`,
    );
  }
  if (response.status === 400) {
    throw new InvalidArgumentError(
      upstreamError(body) ?? 'Neon site search rejected the request',
    );
  }
  if (!response.ok) {
    throw new Error(`Neon site search failed: HTTP ${response.status}`);
  }
  return JSON.stringify({ hits: parseSearchHits(body) }, null, 2);
}

export async function listDocsResources(): Promise<string> {
  const response = await fetch(NEON_DOCS_INDEX_URL, {
    signal: AbortSignal.timeout(DOCS_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    if (response.status === 404) {
      throw new NotFoundError('Neon docs index not found');
    }
    throw new Error(
      `Failed to fetch Neon docs index: ${response.status} ${response.statusText}`,
    );
  }
  return response.text();
}

function validateDocSlug(slug: string): void {
  if (slug.includes('..')) {
    throw new InvalidArgumentError(
      'Invalid doc slug: path traversal ("..") is not allowed',
    );
  }
  if (slug.includes('://')) {
    throw new InvalidArgumentError(
      'Invalid doc slug: absolute URLs are not allowed',
    );
  }
  if (slug.startsWith('/')) {
    throw new InvalidArgumentError(
      'Invalid doc slug: slug must not start with "/"',
    );
  }
}

export async function getDocResource({
  slug,
}: {
  slug: string;
}): Promise<string> {
  validateDocSlug(slug);
  const mdSlug = slug.endsWith('.md') ? slug : `${slug}.md`;
  const url = `${NEON_DOCS_BASE_URL}/${mdSlug}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(DOCS_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    if (response.status === 404) {
      throw new NotFoundError(`Doc page not found: "${mdSlug}"`);
    }
    throw new Error(
      `Failed to fetch doc page "${mdSlug}": ${response.status} ${response.statusText}`,
    );
  }
  return response.text();
}
