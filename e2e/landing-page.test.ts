import { expect, test } from '@playwright/test';

/**
 * What the landing page's script does in a browser (lib/landing/client/). The page reads and
 * navigates without it; these cover what it adds: the client tabs, the categories an address or
 * a link opens, and the head row and address following the scroll.
 */
test.describe('Landing page', () => {
  test('an address that names a client opens with that client selected', async ({
    page,
  }) => {
    await page.goto('/mcp#install-chatgpt');

    await expect(page.getByRole('tab', { name: 'ChatGPT' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('#install-chatgpt')).toBeVisible();
    await expect(page.locator('#install-claude-code')).toBeHidden();
  });

  test('arrow keys, Home and End move between client tabs', async ({
    page,
  }) => {
    await page.goto('/mcp');
    await page.getByRole('tab', { name: 'Claude Code' }).focus();

    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Cursor' })).toBeFocused();
    await expect(page.getByRole('tab', { name: 'Cursor' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('#install-cursor')).toBeVisible();
    await expect(page).toHaveURL(/#install-cursor$/u);

    await page.keyboard.press('End');
    await expect(
      page.getByRole('tab', { name: 'Other clients' }),
    ).toBeFocused();

    // past the last tab is the first
    await page.keyboard.press('ArrowRight');
    await expect(
      page.getByRole('tab', { name: 'Claude Code' }),
    ).toHaveAttribute('aria-selected', 'true');
  });

  test('a category in the parameter table opens only that category', async ({
    page,
  }) => {
    await page.goto('/mcp');
    await page
      .locator('.params')
      .getByRole('link', { name: 'branches', exact: true })
      .click();

    await expect(page.locator('#tools-branches')).toHaveAttribute('open', '');
    await expect(page.locator('.tool-group[open]')).toHaveCount(1);
  });

  test('the head row and the address follow the part in view', async ({
    page,
  }) => {
    await page.goto('/mcp');
    await page.locator('#access').evaluate((part) => {
      part.scrollIntoView();
    });

    await expect(page.locator('html')).toHaveAttribute('data-part', 'access');
    await expect(page.locator('[data-head="access"]')).toBeVisible();
    await expect(page).toHaveURL(/#access$/u);
  });
});
