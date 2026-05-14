import {
  NEON_DOCS_BASE_URL,
  NEON_DOCS_INDEX_URL,
  NEON_DOCS_SEARCH_URL,
} from '../../resources';
import { InvalidArgumentError, NotFoundError } from '../../server/errors';

// Hard cap on upstream docs fetches so a stalled neon.com response
// cannot hold a Vercel concurrency slot for the full 800s function
// duration. The docs-only endpoint is anonymous, so this is a reachable
// vector without authentication.
const DOCS_FETCH_TIMEOUT_MS = 10_000;

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

export async function searchDocs({
  query,
  mode,
  limit,
}: {
  query: string;
  mode?: 'hybrid' | 'fts' | 'semantic';
  limit?: number;
}): Promise<string> {
  const searchUrl = process.env.NEON_DOCS_SEARCH_URL;
  if (!searchUrl) {
    throw new Error(
      'search_docs is not configured: set the NEON_DOCS_SEARCH_URL environment variable to the deployed docs search API URL.',
    );
  }

  const params = new URLSearchParams();
  params.set('q', query);
  params.set('compact', 'true');
  if (mode && mode !== 'hybrid') params.set('mode', mode);
  if (limit) params.set('limit', String(limit));

  const url = `${searchUrl}/api/docs-search?${params}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(DOCS_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(
      `Failed to search docs: ${response.status} ${response.statusText}`,
    );
  }
  return response.text();
}
