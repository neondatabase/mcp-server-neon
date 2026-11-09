import { test, expect, type Page } from '@playwright/test';
import {
  ONBOARD_AGENT_PROMPT,
  renderAuthCompletePage,
} from '../mcp/oauth/auth-complete-page.js';
import { signPageView } from '../mcp/oauth/auth-complete-page-view.js';

const PAGE_VIEW_ID = '3f6a9a3e-2c1b-4d1e-9f5a-0b8c7d6e5f40';

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
async function serveSuccessPage(
  page: Page,
  returnUrl?: string,
  withPageView = true,
) {
  await page.route('**/callback?*', async (route) => {
    const { html, headers } = renderAuthCompletePage({
      outcome: 'success',
      returnUrl,
      // Signed with the secret playwright.config.ts gives the dev server.
      ...(withPageView
        ? {
            pageViewId: PAGE_VIEW_ID,
            pageViewToken: signPageView(PAGE_VIEW_ID),
          }
        : {}),
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

  test('shows a neutral page for a /callback with nothing in it', async ({
    page,
  }) => {
    await page.goto('/callback');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Nothing to finish here',
    );
  });

  for (const [label, clipboard] of [
    ['without the clipboard API', 'missing'],
    ['when writeText throws', 'throws'],
  ] as const) {
    test(`falls back to manual copy ${label}`, async ({ page }) => {
      await page.addInitScript((mode) => {
        Object.defineProperty(navigator, 'clipboard', {
          value:
            mode === 'missing'
              ? undefined
              : {
                  writeText() {
                    throw new Error('blocked');
                  },
                },
        });
      }, clipboard);
      await serveSuccessPage(page);
      await page.goto('/callback?code=c&state=s');

      await page.getByRole('button', { name: 'Copy prompt' }).click();

      const prompt = page.getByLabel(
        'Copy this prompt into your coding agent:',
      );
      await expect(prompt).toBeVisible();
      await expect(prompt).toBeFocused();
      await expect(prompt).toHaveValue(ONBOARD_AGENT_PROMPT);
    });
  }

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

  test('reports each action to the events endpoint', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    // A 204 keeps the page in place, so the hand-off on load and the return
    // link can both be exercised.
    await page.route('**/__app?*', (route) => route.fulfill({ status: 204 }));
    await context.route('https://neon.com/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: 'docs' }),
    );
    await serveSuccessPage(page, '/__app?code=c&state=s');
    // The hand-off starts during load and the 204 cancels it, so the load
    // event this navigation waits for by default never fires.
    await page.goto('/callback?code=c&state=s', { waitUntil: 'commit' });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'You’ve approved access to Neon',
    );

    const actions: [string, () => Promise<void>][] = [
      [
        'prompt_copied',
        () => page.getByRole('button', { name: 'Copy prompt' }).click(),
      ],
      [
        'docs_clicked',
        () => page.getByRole('link', { name: /Read the docs/ }).click(),
      ],
      [
        'return_clicked',
        () => page.getByRole('link', { name: 'Return to your app' }).click(),
      ],
    ];
    for (const [action, act] of actions) {
      const [beacon] = await Promise.all([
        page.waitForRequest(
          (request) =>
            request.method() === 'POST' &&
            request.url().endsWith('/api/auth-complete/events'),
        ),
        act(),
      ]);
      expect(beacon.postDataJSON()).toEqual({
        pageViewId: PAGE_VIEW_ID,
        token: expect.any(String),
        action,
      });
      expect((await beacon.response())?.status()).toBe(204);
    }
  });

  test('sends no action events without a page view', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const beacons: string[] = [];
    page.on('request', (request) => {
      if (request.url().endsWith('/api/auth-complete/events')) {
        beacons.push(request.url());
      }
    });
    await serveSuccessPage(page, undefined, false);
    await page.goto('/callback?code=c&state=s');

    await page.getByRole('button', { name: 'Copy prompt' }).click();
    await expect(page.getByRole('button', { name: 'Copied!' })).toBeVisible();
    // The copy handler sends its beacon before it changes the button, so one
    // would already be on its way.
    await page.waitForTimeout(500);
    expect(beacons).toEqual([]);
  });
});
