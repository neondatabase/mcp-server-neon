import { NEON_DOCS_BASE_URL, NEON_DOCS_INDEX_URL } from '../../resources';
import { InvalidArgumentError, NotFoundError } from '../../server/errors';

export async function listDocsResources(): Promise<string> {
  const response = await fetch(NEON_DOCS_INDEX_URL);
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
  const response = await fetch(url);
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
