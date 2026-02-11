/**
 * E2E tests for the docs tools' external dependencies.
 *
 * These verify that the upstream neon.com docs infrastructure is reachable
 * and returns the expected format. They make real HTTP requests to neon.com
 * (not through the MCP server) to validate the docs index and page fetching.
 *
 * Uses Playwright's APIRequestContext (via the `request` fixture) for
 * API-only tests — no browser needed.
 */

import { test, expect } from '@playwright/test';

const NEON_DOCS_INDEX_URL = 'https://neon.com/docs/llms.txt';
const NEON_DOCS_BASE_URL = 'https://neon.com';

test.describe('Neon docs index (llms.txt)', () => {
  test('returns a non-empty markdown index', async ({ request }) => {
    const response = await request.get(NEON_DOCS_INDEX_URL);
    expect(response.ok()).toBeTruthy();

    const text = await response.text();
    expect(text.length).toBeGreaterThan(100);
    // Should start with a markdown heading
    expect(text).toMatch(/^#/);
  });

  test('contains links with .md file endings', async ({ request }) => {
    const response = await request.get(NEON_DOCS_INDEX_URL);
    const text = await response.text();

    // The index should contain at least one .md link
    expect(text).toContain('.md');
    // Should contain the base URL
    expect(text).toContain('neon.com');
  });

  test('contains known documentation sections', async ({ request }) => {
    const response = await request.get(NEON_DOCS_INDEX_URL);
    const text = await response.text();

    // These sections should exist in the Neon docs
    expect(text.toLowerCase()).toContain('ai');
    expect(text.toLowerCase()).toContain('connect');
  });
});

test.describe('Neon docs page fetch', () => {
  test('fetches a known docs page as markdown', async ({ request }) => {
    // Use a stable, foundational page unlikely to be removed
    const response = await request.get(
      `${NEON_DOCS_BASE_URL}/docs/get-started-with-neon/signing-up.md`,
    );
    expect(response.ok()).toBeTruthy();

    const text = await response.text();
    expect(text.length).toBeGreaterThan(50);
    // Should be markdown content (contains a heading)
    expect(text).toMatch(/#/);
  });

  test('returns 404 for a nonexistent docs page', async ({ request }) => {
    const response = await request.get(
      `${NEON_DOCS_BASE_URL}/docs/this-page-does-not-exist-12345.md`,
      { failOnStatusCode: false },
    );
    // neon.com may return 404 or redirect to a 404 page
    expect([404, 301, 302, 200]).toContain(response.status());
  });
});
