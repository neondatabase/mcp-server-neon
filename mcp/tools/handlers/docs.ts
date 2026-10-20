import { NEON_DOCS_INDEX_URL, NEON_SITE_SEARCH_URL } from '../../../lib/config';
import { NEON_DOCS_BASE_URL } from '../../resources';
import { z } from 'zod/v3';
import { InvalidArgumentError, NotFoundError } from '../../server/errors';

// Hard cap on upstream docs fetches so a stalled neon.com response
// cannot hold a Vercel concurrency slot for the full 800s function
// duration. The docs-only endpoint is anonymous, so this is a reachable
// vector without authentication.
const DOCS_FETCH_TIMEOUT_MS = 10_000;

const UNEXPECTED_SEARCH_RESPONSE =
  'Neon site search returned an unexpected response';

// Unknown keys (score, collection) are stripped; they are not part of the tool result.
const searchDocsResponseSchema = z.object({
  hits: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      slug: z.string(),
      category: z.string(),
      breadcrumb: z.array(z.string()),
      heading: z.string(),
      excerpt: z.string(),
    }),
  ),
});

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
  const parsed = searchDocsResponseSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `${UNEXPECTED_SEARCH_RESPONSE}: ${issue.path.join('.')} ${issue.message}`,
    );
  }
  return JSON.stringify(parsed.data, null, 2);
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
