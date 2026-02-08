/**
 * E2E tests for the OAuth consent page.
 *
 * These tests verify the authorization UI including:
 * - Preset tab button rendering and behavior
 * - Custom preset with scope category checkboxes
 * - Production branch protection checkbox
 * - Write scope toggling based on preset selection
 * - Collapsible permission details
 * - Form submission with correct values
 *
 * Prerequisites:
 * - Next.js dev server running with OAUTH_DATABASE_URL configured
 * - Playwright starts the server via webServer config
 *
 * The test dynamically registers a client via /api/register,
 * so no manual client seeding is required.
 */

import { test, expect } from '@playwright/test';

type RegisteredClient = {
  client_id: string;
  client_secret: string;
  client_name: string;
  redirect_uris: string[];
};

const TEST_REDIRECT_URI = 'http://localhost:9999/callback';

/**
 * Register a test client via the dynamic client registration endpoint.
 */
async function registerTestClient(
  baseURL: string,
): Promise<RegisteredClient> {
  const response = await fetch(`${baseURL}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Playwright Test Client',
      redirect_uris: [TEST_REDIRECT_URI],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      client_uri: 'http://localhost:9999',
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to register test client: ${response.status} ${body}`,
    );
  }

  return response.json();
}

/**
 * Build the /api/authorize URL with the required OAuth query parameters.
 */
function buildAuthorizeUrl(clientId: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: TEST_REDIRECT_URI,
    scope: 'read write',
    state: 'test-state-e2e',
  });
  return `/api/authorize?${params.toString()}`;
}

test.describe('OAuth Consent Page', () => {
  let client: RegisteredClient;

  test.beforeAll(async ({ }, testInfo) => {
    const baseURL =
      testInfo.project.use.baseURL ?? 'http://localhost:3000';
    client = await registerTestClient(baseURL);
  });

  test('renders the authorization page with client info', async ({
    page,
  }) => {
    await page.goto(buildAuthorizeUrl(client.client_id));

    // Page should show the authorization heading with client name
    await expect(
      page.getByRole('heading', { name: 'Authorize Playwright Test' }),
    ).toBeVisible();
  });

  test('renders four preset tab buttons', async ({ page }) => {
    await page.goto(buildAuthorizeUrl(client.client_id));

    // Four visible preset tab buttons (including custom)
    const tabs = page.locator('button.preset-tab');
    await expect(tabs).toHaveCount(4);

    // Verify tab labels
    await expect(tabs.nth(0)).toHaveText('Custom');
    await expect(tabs.nth(1)).toHaveText('Local Development');
    await expect(tabs.nth(2)).toHaveText('Production Use');
    await expect(tabs.nth(3)).toHaveText('Full Access');
  });

  test('full_access preset is selected by default', async ({ page }) => {
    await page.goto(buildAuthorizeUrl(client.client_id));

    const fullAccessTab = page.locator(
      'button.preset-tab[data-preset="full_access"]',
    );
    await expect(fullAccessTab).toHaveClass(/active/);

    // Hidden preset input should have full_access value
    const presetInput = page.locator('#preset-input');
    await expect(presetInput).toHaveValue('full_access');
  });

  test('renders preset labels with descriptions', async ({ page }) => {
    await page.goto(buildAuthorizeUrl(client.client_id));

    // Verify tab labels are visible
    await expect(
      page.getByText('Local Development', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Production Use', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Full Access', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Custom', { exact: true }),
    ).toBeVisible();

    // Default description (full_access) is visible
    await expect(
      page.getByText('Full access including project deletion'),
    ).toBeVisible();
  });

  test('clicking preset tabs updates description and hidden input', async ({
    page,
  }) => {
    await page.goto(buildAuthorizeUrl(client.client_id));

    const presetInput = page.locator('#preset-input');
    const description = page.locator('#preset-desc');

    // Click Local Development
    await page.locator('button.preset-tab[data-preset="local_development"]').click();
    await expect(presetInput).toHaveValue('local_development');
    await expect(description).toContainText('Full development access');

    // Click Production Use
    await page.locator('button.preset-tab[data-preset="production_use"]').click();
    await expect(presetInput).toHaveValue('production_use');
    await expect(description).toContainText('Read-only access');

    // Click Full Access
    await page.locator('button.preset-tab[data-preset="full_access"]').click();
    await expect(presetInput).toHaveValue('full_access');
    await expect(description).toContainText('Full access including project deletion');
  });

  test('renders production branch protection checkbox', async ({
    page,
  }) => {
    await page.goto(buildAuthorizeUrl(client.client_id));

    const protectCheckbox = page.locator(
      'input[type="checkbox"][name="protect_production"]',
    );
    await expect(protectCheckbox).toBeVisible();
    await expect(protectCheckbox).not.toBeChecked();

    // Label text
    await expect(
      page.getByText('Protect production branches'),
    ).toBeVisible();
  });

  test('selecting Production Use marks write scope as disabled', async ({
    page,
  }) => {
    await page.goto(buildAuthorizeUrl(client.client_id));

    // Initially (full_access), write scope input should be enabled
    const writeScopeInput = page.locator('#write-scope-input');
    await expect(writeScopeInput).not.toBeDisabled();

    // Click Production Use tab
    await page.locator('button.preset-tab[data-preset="production_use"]').click();

    // Now write scope should be disabled
    await expect(writeScopeInput).toBeDisabled();
  });

  test('selecting Full Access re-enables write scope', async ({
    page,
  }) => {
    await page.goto(buildAuthorizeUrl(client.client_id));

    // Select Production Use first
    await page.locator('button.preset-tab[data-preset="production_use"]').click();
    const writeScopeInput = page.locator('#write-scope-input');
    await expect(writeScopeInput).toBeDisabled();

    // Switch back to Full Access
    await page.locator('button.preset-tab[data-preset="full_access"]').click();
    await expect(writeScopeInput).not.toBeDisabled();
  });

  test('selecting Local Development keeps write scope enabled', async ({
    page,
  }) => {
    await page.goto(buildAuthorizeUrl(client.client_id));

    await page.locator('button.preset-tab[data-preset="local_development"]').click();

    const writeScopeInput = page.locator('#write-scope-input');
    await expect(writeScopeInput).not.toBeDisabled();
  });

  test('custom preset shows scope category checkboxes', async ({
    page,
  }) => {
    await page.goto(buildAuthorizeUrl(client.client_id));

    // Scope categories should be hidden by default
    const scopeCategories = page.locator('#scope-categories');
    await expect(scopeCategories).toBeHidden();

    // Click Custom tab
    await page.locator('button.preset-tab[data-preset="custom"]').click();

    // Scope categories should now be visible
    await expect(scopeCategories).toBeVisible();

    // Should show 7 category checkboxes, all checked by default
    const checkboxes = scopeCategories.locator('input[name="scope_categories"]');
    await expect(checkboxes).toHaveCount(7);
    for (let i = 0; i < 7; i++) {
      await expect(checkboxes.nth(i)).toBeChecked();
    }

    // Should show category labels within the scope-categories section
    const categories = page.locator('#scope-categories');
    await expect(categories.getByText('Project Management')).toBeVisible();
    await expect(categories.getByText('Branch Management')).toBeVisible();
    await expect(categories.getByText('Schema and Table Inspection')).toBeVisible();
    await expect(categories.getByText('SQL Query Execution')).toBeVisible();
    await expect(categories.getByText('Query Performance Optimization')).toBeVisible();
    await expect(categories.getByText('Neon Auth')).toBeVisible();
    await expect(categories.getByText('Documentation and Resources')).toBeVisible();

    // SENSITIVE badge on SQL Query Execution
    await expect(categories.locator('.badge-sensitive')).toBeVisible();
  });

  test('custom preset hides permission details and vice versa', async ({
    page,
  }) => {
    await page.goto(buildAuthorizeUrl(client.client_id));

    const scopeCategories = page.locator('#scope-categories');
    const permDetails = page.locator('#perm-details');

    // Default (full_access): permission details visible, categories hidden
    await expect(permDetails).toBeVisible();
    await expect(scopeCategories).toBeHidden();

    // Switch to Custom: categories visible, permission details hidden
    await page.locator('button.preset-tab[data-preset="custom"]').click();
    await expect(scopeCategories).toBeVisible();
    await expect(permDetails).toBeHidden();

    // Switch back to Local Development: categories hidden, permission details visible
    await page.locator('button.preset-tab[data-preset="local_development"]').click();
    await expect(scopeCategories).toBeHidden();
    await expect(permDetails).toBeVisible();
  });

  test('permission details collapsible expands and collapses', async ({
    page,
  }) => {
    await page.goto(buildAuthorizeUrl(client.client_id));

    const permDetails = page.locator('#perm-details');
    const summary = permDetails.locator('summary');

    // Initially collapsed - category details not visible
    await expect(permDetails.locator('.category-detail').first()).toBeHidden();

    // Click to expand
    await summary.click();

    // Category details should now be visible
    await expect(permDetails.locator('.category-detail').first()).toBeVisible();
    await expect(permDetails.getByText('Project Management')).toBeVisible();

    // Click to collapse
    await summary.click();
    await expect(permDetails.locator('.category-detail').first()).toBeHidden();
  });

  test('custom preset scope categories can be toggled', async ({
    page,
  }) => {
    await page.goto(buildAuthorizeUrl(client.client_id));

    // Switch to Custom
    await page.locator('button.preset-tab[data-preset="custom"]').click();

    const checkboxes = page.locator('#scope-categories input[name="scope_categories"]');
    const firstCheckbox = checkboxes.first();

    // All start checked
    await expect(firstCheckbox).toBeChecked();

    // Uncheck first category
    await firstCheckbox.uncheck();
    await expect(firstCheckbox).not.toBeChecked();

    // Re-check it
    await firstCheckbox.check();
    await expect(firstCheckbox).toBeChecked();
  });

  test('protection checkbox can be toggled', async ({ page }) => {
    await page.goto(buildAuthorizeUrl(client.client_id));

    const protectCheckbox = page.locator(
      'input[type="checkbox"][name="protect_production"]',
    );

    // Initially unchecked
    await expect(protectCheckbox).not.toBeChecked();

    // Check it
    await protectCheckbox.check();
    await expect(protectCheckbox).toBeChecked();

    // Uncheck it
    await protectCheckbox.uncheck();
    await expect(protectCheckbox).not.toBeChecked();
  });

  test('approve button and deny button are present', async ({
    page,
  }) => {
    await page.goto(buildAuthorizeUrl(client.client_id));

    await expect(
      page.getByRole('button', { name: 'Approve' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Deny' }),
    ).toBeVisible();
  });

  test('caution banner is visible', async ({ page }) => {
    await page.goto(buildAuthorizeUrl(client.client_id));

    await expect(
      page.getByText('AI agents can make mistakes'),
    ).toBeVisible();
  });

  test('footer with legal links is visible', async ({ page }) => {
    await page.goto(buildAuthorizeUrl(client.client_id));

    await expect(
      page.getByRole('link', { name: 'Terms of Service' }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Privacy Policy' }),
    ).toBeVisible();
    await expect(
      page.getByText('Neon Serverless Postgres'),
    ).toBeVisible();
  });

  test('form has correct hidden inputs for state and scopes', async ({
    page,
  }) => {
    await page.goto(buildAuthorizeUrl(client.client_id));

    // State input should have a base64-encoded value
    const stateInput = page.locator('input[name="state"]');
    await expect(stateInput).toHaveAttribute('type', 'hidden');
    const stateValue = await stateInput.getAttribute('value');
    expect(stateValue).toBeTruthy();

    // Read scope should always be present as hidden input
    const readScopeInput = page.locator(
      'input[name="scopes"][value="read"]',
    );
    await expect(readScopeInput).toHaveAttribute('type', 'hidden');

    // Preset input should be hidden with default value
    const presetInput = page.locator('#preset-input');
    await expect(presetInput).toHaveAttribute('type', 'hidden');
    await expect(presetInput).toHaveValue('full_access');
  });

  test('form submits to /api/authorize POST', async ({ page }) => {
    await page.goto(buildAuthorizeUrl(client.client_id));

    const form = page.locator('#authorize-form');
    await expect(form).toHaveAttribute('method', 'POST');
    await expect(form).toHaveAttribute('action', '/api/authorize');
  });

  test('returns 400 for invalid client_id', async ({ page }) => {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: 'nonexistent-client-id',
      redirect_uri: TEST_REDIRECT_URI,
      scope: 'read write',
      state: 'test-state',
    });

    const response = await page.goto(`/api/authorize?${params.toString()}`);
    expect(response?.status()).toBe(400);
  });

  test('renders project scope input as editable by default', async ({
    page,
  }) => {
    await page.goto(buildAuthorizeUrl(client.client_id));

    const projectInput = page.locator('#project-id-input');
    await expect(projectInput).toBeVisible();
    await expect(projectInput).toHaveValue('');
    await expect(projectInput).not.toHaveAttribute('readonly');

    // Label and description
    const section = page.locator('.project-scope-section');
    await expect(section.getByText('Project scope')).toBeVisible();
    await expect(
      section.getByText('Restrict access to a single Neon project'),
    ).toBeVisible();
  });

  test('project scope input accepts user input', async ({ page }) => {
    await page.goto(buildAuthorizeUrl(client.client_id));

    const projectInput = page.locator('#project-id-input');
    await projectInput.fill('proj-my-test-123');
    await expect(projectInput).toHaveValue('proj-my-test-123');
  });

  test('project scope input is readonly when X-Neon-Project-Id header is set', async ({
    request,
  }, testInfo) => {
    const baseURL =
      testInfo.project.use.baseURL ?? 'http://localhost:3000';

    // Register a fresh client to avoid cookie-based auto-approval
    const freshClient = await registerTestClient(baseURL);
    const url = buildAuthorizeUrl(freshClient.client_id);

    const response = await request.get(url, {
      headers: { 'X-Neon-Project-Id': 'proj-header-456' },
    });
    expect(response.ok()).toBeTruthy();

    const html = await response.text();

    // The input should have the header value and be readonly
    expect(html).toContain('value="proj-header-456"');
    expect(html).toContain('id="project-id-input"');
    expect(html).toMatch(/value="proj-header-456"[^>]*readonly/);
  });

  test('project scope input is inside the form', async ({ page }) => {
    await page.goto(buildAuthorizeUrl(client.client_id));

    // The project_id input should be inside the authorize form
    const form = page.locator('#authorize-form');
    const projectInput = form.locator('input[name="project_id"]');
    await expect(projectInput).toBeVisible();
    await expect(projectInput).toHaveAttribute('type', 'text');
  });
});
