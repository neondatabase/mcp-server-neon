import { test, expect, type Page } from '@playwright/test';
import {
  ONBOARD_AGENT_PROMPT,
  renderAuthCompletePage,
} from '../mcp/oauth/auth-complete-page.js';

function watchCspViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) {
      violations.push(message.text());
    }
  });
  return violations;
}

/**
 * A real success needs the upstream code exchange, so the browser gets the
 * page /callback builds for it, headers included.
 */
async function serveSuccessPage(page: Page, returnUrl?: string) {
  await page.route('**/callback?*', async (route) => {
    const { html, headers } = renderAuthCompletePage({
      outcome: 'success',
      returnUrl,
    });
    await route.fulfill({ status: 200, headers, body: html });
  });
}

test.describe('auth completion page', () => {
  test('a spent /callback shows the failed page and drops the query under its CSP', async ({
    page,
  }) => {
    const violations = watchCspViolations(page);

    const response = await page.goto('/callback?code=spent&state=spent');

    expect(response?.status()).toBe(400);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Couldn’t connect to Neon',
    );
    // The query is dropped by the page's nonce-tagged script, so this also
    // proves the CSP lets that script run.
    await expect(page).toHaveURL(/\/callback$/);
    expect(violations).toEqual([]);
  });

  test('a cancel without a usable session shows the cancelled page', async ({
    page,
  }) => {
    await page.goto('/callback?error=access_denied');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Connection cancelled',
    );
    await expect(page.getByRole('button', { name: 'Copy prompt' })).toHaveCount(
      0,
    );
  });

  test('copies the agent setup prompt', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const violations = watchCspViolations(page);
    await serveSuccessPage(page);
    await page.goto('/callback?code=c&state=s');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'You’ve approved access to Neon',
    );
    await page.getByRole('button', { name: 'Copy prompt' }).click();

    await expect(page.getByRole('button', { name: 'Copied!' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      ONBOARD_AGENT_PROMPT,
    );
    expect(violations).toEqual([]);
  });

  test('falls back to manual copy without the clipboard API', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { value: undefined });
    });
    await serveSuccessPage(page);
    await page.goto('/callback?code=c&state=s');

    await page.getByRole('button', { name: 'Copy prompt' }).click();

    const prompt = page.getByLabel('Copy this prompt into your coding agent:');
    await expect(prompt).toBeVisible();
    await expect(prompt).toBeFocused();
    await expect(prompt).toHaveValue(ONBOARD_AGENT_PROMPT);
  });

  test('hands the redirect back to the app on load', async ({ page }) => {
    // Browsers in tests cannot follow cursor:// and the like, so the return
    // URL is a same-origin stand-in; the page treats it the same way.
    await page.route('**/__app?*', (route) =>
      route.fulfill({ contentType: 'text/html', body: 'app' }),
    );
    await serveSuccessPage(page, '/__app?code=c&state=s');

    await page.goto('/callback?code=c&state=s');

    await page.waitForURL('**/__app?code=c&state=s');
  });
});
