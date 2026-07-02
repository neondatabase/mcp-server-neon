export const NEON_DOCS_INDEX_URL = 'https://neon.com/docs/llms.txt';
export const NEON_DOCS_BASE_URL = 'https://neon.com';

export async function fetchRawGithubContent(rawPath: string) {
  const path = rawPath.replace('/blob', '');

  const response = await fetch(`https://raw.githubusercontent.com${path}`);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch GitHub content: ${response.status} ${response.statusText}`,
    );
  }
  return response.text();
}
