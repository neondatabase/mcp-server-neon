import { expect, test } from '@playwright/test';

test.describe('Landing page', () => {
  test('opens the linked client and supports keyboard navigation through its tabs and panel', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/mcp#install-chatgpt');

    const chatgpt = page.getByRole('tab', { name: 'ChatGPT' });
    const claude = page.getByRole('tab', { name: 'Claude Code' });
    const claudePanel = page.getByRole('tabpanel', { name: 'Claude Code' });

    await expect(chatgpt).toHaveAttribute('aria-selected', 'true');
    await expect(chatgpt).toBeInViewport();
    await expect(page.getByRole('tabpanel', { name: 'ChatGPT' })).toBeVisible();
    await expect(claudePanel).toBeHidden();

    await chatgpt.press('Home');
    await expect(claude).toBeFocused();
    await claude.press('ArrowRight');
    const cursor = page.getByRole('tab', { name: 'Cursor' });
    await expect(cursor).toBeFocused();
    await expect(page).toHaveURL(/#install-cursor$/u);
    await expect(
      page.getByRole('tabpanel', { name: 'Cursor' }).getByRole('link', {
        name: 'Open in Cursor',
      }),
    ).toHaveAttribute(
      'href',
      /^cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?/u,
    );

    await cursor.press('End');
    const other = page.getByRole('tab', { name: 'Other clients' });
    await expect(other).toBeFocused();
    await expect(other).toBeInViewport();
    await other.press('ArrowRight');
    await expect(claude).toBeFocused();
    await expect(claude).toHaveAttribute('aria-selected', 'true');

    const y = await page.evaluate(() => scrollY);
    await page.keyboard.press('ArrowDown');
    await expect
      .poll(async () => page.evaluate(() => scrollY))
      .toBeGreaterThan(y);
    await expect(claude).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(claudePanel).toBeFocused();
  });

  test('opens a linked tool category and folds it when following another category link', async ({
    page,
  }) => {
    await page.goto('/mcp#tools-projects');
    const projects = page.locator('#tools-projects');
    const branches = page.locator('#tools-branches');
    await expect(projects).toHaveAttribute('open', '');

    await page
      .getByRole('article', { name: 'Limit access' })
      .getByRole('link', { name: 'branches', exact: true })
      .click();

    await expect(page).toHaveURL(/#tools-branches$/u);
    await expect(branches).toHaveAttribute('open', '');
    await expect(branches.locator('summary')).toBeInViewport();
    await expect(projects).not.toHaveAttribute('open');
  });

  test('updates the sticky heading and URL as the document scrolls', async ({
    page,
  }) => {
    await page.goto('/mcp');
    const heading = page.locator('.sheet-head');
    const historyLength = await page.evaluate(() => history.length);
    await expect(heading.getByText('Installation guide')).toBeVisible();

    await page
      .getByRole('article', { name: 'Limit access' })
      .evaluate((part) => {
        part.scrollIntoView();
      });

    await expect(heading.getByText('Limit access')).toBeVisible();
    await expect(page).toHaveURL(/#access$/u);
    expect(await page.evaluate(() => history.length)).toBe(historyLength);
  });

  test('keeps the mobile section link current and clears the fragment at the cover', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/mcp?category=docs');

    const access = page
      .getByRole('navigation', { name: 'Parts' })
      .getByRole('link', { name: 'Limit access' });

    await access.click();
    await expect(access).toHaveAttribute('aria-current', 'location');
    await expect(
      page.getByRole('heading', { name: 'Limit access' }),
    ).toBeInViewport();

    await page.evaluate(() => {
      scrollTo({ top: 0, behavior: 'instant' });
    });
    await expect(page).toHaveURL(/\/mcp\?category=docs$/u);
    await expect(page.getByRole('heading', { level: 1 })).toBeInViewport();
  });

  test('copies the deployment URL and the exact highlighted install command', async ({
    baseURL,
    context,
    page,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/mcp');

    const serverUrl = new URL('/mcp', baseURL).href;

    const clipboard = async () =>
      page.evaluate(async () => navigator.clipboard.readText());

    const url = page.getByRole('group', { name: 'MCP server URL' });
    await expect(url.getByText(serverUrl)).toBeVisible();
    await url.getByRole('button', { name: 'Copy MCP server URL' }).click();
    await expect(url.getByRole('button', { name: 'Copied' })).toBeVisible();
    await expect.poll(clipboard).toBe(serverUrl);

    const panel = page.getByRole('tabpanel', { name: 'Claude Code' });
    const command = `claude mcp add --transport http "neon" '${serverUrl}'`;
    await expect(panel.locator('pre code')).toHaveText(command);
    await panel.getByRole('button', { name: 'Copy', exact: true }).click();
    await expect.poll(clipboard).toBe(command);
  });

  test.describe('with JavaScript disabled', () => {
    test.use({
      javaScriptEnabled: false,
      viewport: { width: 390, height: 844 },
    });

    test('follows the visual focus order and keeps client instructions reachable', async ({
      page,
    }) => {
      await page.goto('/mcp');
      await page.keyboard.press('Tab');

      await expect(
        page.getByRole('link', { name: 'Neon', exact: true }),
      ).toBeFocused();
      await expect(
        page.getByRole('button', { name: 'Copy MCP server URL' }),
      ).toBeHidden();
      await expect(
        page.getByRole('heading', { name: 'Claude Code', exact: true }),
      ).toBeVisible();

      await page
        .getByRole('navigation', { name: 'MCP clients' })
        .getByRole('link', { name: 'Other clients' })
        .click();

      await expect(page).toHaveURL(/#install-other$/u);
      await expect(
        page.getByRole('heading', { name: 'Other clients' }),
      ).toBeInViewport();
    });
  });
});
