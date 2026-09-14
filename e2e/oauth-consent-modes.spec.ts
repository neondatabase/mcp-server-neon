import { test, expect, type Page } from '@playwright/test';
import {
  authorizePath,
  capture,
  openAuthorize,
  registerClient,
  VALID_REGISTER_PAYLOAD,
} from './oauth-helpers';

async function clearScreenshotInteractionState(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  await page.mouse.move(0, 0);
}

test.describe('OAuth consent modes', () => {
  test('A1 fixed read-only confirmation when the client asked for writes', async ({
    page,
    request,
  }) => {
    await openAuthorize(page, request, {
      resource:
        'https://mcp.neon.tech/mcp?projectId=proj-example&category=querying,schema&readonly=true',
    });
    await expect(page.getByText('proj-example')).toBeVisible();
    await expect(page.locator('.facts')).toContainText('Querying');
    await expect(page.locator('.scope-checkbox')).toHaveCount(0);
    await expect(page.locator('[data-access-mode]')).toHaveText('Read-only');
    await capture(page, 'A1-readonly-confirmation');
  });

  test('A2 fixed writable confirmation', async ({ page, request }) => {
    await openAuthorize(page, request, {
      resource:
        'https://mcp.neon.tech/mcp?projectId=proj-example&category=querying,schema',
    });
    await expect(page.locator('[data-access-mode]')).toHaveText(
      'Read and write',
    );
    await expect(page.locator('.scope-checkbox')).toHaveCount(0);
    await capture(page, 'A2-writable-confirmation');
  });

  test('A3 same resource with client read-only scope', async ({
    page,
    request,
  }) => {
    await openAuthorize(page, request, {
      scope: 'read',
      resource:
        'https://mcp.neon.tech/mcp?projectId=proj-example&category=querying,schema',
    });
    await expect(page.locator('[data-access-mode]')).toHaveText('Read-only');
    await expect(page.locator('.scope-checkbox')).toHaveCount(0);
    await capture(page, 'A3-client-read-confirmation');
  });

  test('A4 readonly=false alone is fixed confirmation', async ({
    page,
    request,
  }) => {
    await openAuthorize(page, request, {
      resource: 'https://mcp.neon.tech/mcp?readonly=false',
    });
    await expect(page.getByText('All projects you can access')).toBeVisible();
    await expect(page.getByText('All categories')).toBeVisible();
    await expect(page.locator('input[name="projectMode"]')).toHaveCount(0);
    await expect(page.locator('[data-access-mode]')).toHaveText(
      'Read and write',
    );
    await capture(page, 'A4-readonly-false-confirmation');
  });

  test('A4b resource readonly=false stays writable despite registration x-read-only', async ({
    page,
    request,
  }) => {
    await openAuthorize(
      page,
      request,
      { resource: 'https://mcp.neon.tech/mcp?readonly=false' },
      { 'x-read-only': 'true' },
    );
    await expect(page.locator('[data-access-mode]')).toHaveText(
      'Read and write',
    );
    await expect(page.locator('.scope-checkbox')).toHaveCount(0);
    await expect(page.locator('input[name="projectMode"]')).toHaveCount(0);
    await capture(page, 'A4-readonly-false-vs-header');
  });

  test('A5 project-only, category-only, and empty grant params', async ({
    page,
    request,
  }) => {
    await openAuthorize(page, request, {
      resource: 'https://mcp.neon.tech/mcp?projectId=proj-example',
    });
    await capture(page, 'A5-project-only');
    await openAuthorize(page, request, {
      resource: 'https://mcp.neon.tech/mcp?category=querying',
    });
    await capture(page, 'A5-category-only');
    await openAuthorize(page, request, {
      resource: 'https://mcp.neon.tech/mcp?category=',
    });
    await capture(page, 'A5-empty-category');
  });

  test('A6 mixed unknown categories and unknown-only', async ({
    page,
    request,
  }) => {
    await openAuthorize(page, request, {
      resource: 'https://mcp.neon.tech/mcp?category=querying,not-a-category',
    });
    await expect(
      page.getByText('Unsupported categories will not be granted'),
    ).toBeVisible();
    await capture(page, 'A6-mixed-unknown');
    await openAuthorize(page, request, {
      resource: 'https://mcp.neon.tech/mcp?category=not-a-category',
    });
    await expect(
      page.getByText('Search and Fetch stay available'),
    ).toBeVisible();
    await capture(page, 'A6-unknown-only');
    await openAuthorize(page, request, {
      resource:
        'https://mcp.neon.tech/mcp?projectId=proj-example&category=not-a-category',
    });
    await expect(
      page.getByText('No tools are available for this connection.'),
    ).toBeVisible();
    await capture(page, 'A6-unknown-only-project');
  });

  test('B1 bare resource initial all/all/write collapsed tools', async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openAuthorize(page, request, {
      resource: 'https://mcp.neon.tech/mcp',
    });
    const logoLoaded = await page
      .getByRole('img', { name: 'Neon' })
      .evaluate(
        (image) =>
          image instanceof HTMLImageElement &&
          image.complete &&
          image.naturalWidth > 0,
      );
    expect(logoLoaded).toBe(true);
    const clientDetails = page.locator('details.client-verify');
    const clientSummary = clientDetails.locator('summary');
    await expect(clientSummary).toHaveText(
      'App details · example.com → 127.0.0.1:55667',
    );
    await expect(clientDetails).not.toHaveAttribute('open', '');
    await clientSummary.focus();
    await page.keyboard.press('Enter');
    await expect(clientDetails).toHaveAttribute('open', '');
    await expect(
      page.getByText('http://127.0.0.1:55667/callback'),
    ).toBeVisible();
    await page.keyboard.press('Space');
    await expect(clientDetails).not.toHaveAttribute('open', '');
    await clientSummary.blur();
    await clientSummary.click();
    await capture(page, 'B1-client-details-expanded');
    await clientSummary.click();
    await expect(page.locator('.scope-checkbox')).toBeChecked();
    await expect(page.getByText('Allow writes')).toBeVisible();
    await expect(page.locator('[data-project-id-field]')).toBeHidden();
    await expect(
      page.getByRole('button', { name: 'View tools' }),
    ).toBeVisible();
    await expect(
      page.getByText('Tool categories', { exact: true }),
    ).toBeVisible();
    const categoryScroll = page.locator('[data-category-scroll]');
    await expect(
      categoryScroll.locator('span').filter({ hasText: 'Projects' }),
    ).toBeInViewport();
    await expect(categoryScroll).toBeVisible();
    const categoryOverflows = await categoryScroll.evaluate(
      (el) => el.scrollHeight > el.clientHeight + 1 && el.clientHeight >= 80,
    );
    expect(categoryOverflows).toBe(true);
    await page.getByRole('button', { name: 'Clear categories' }).click();
    expect(await page.locator('input[name="category"]:checked').count()).toBe(
      0,
    );
    await page.getByRole('button', { name: 'Select all' }).click();
    expect(await page.locator('input[name="category"]:checked').count()).toBe(
      12,
    );
    expect(
      await categoryScroll.evaluate(
        (element) =>
          getComputedStyle(element).gridTemplateColumns.split(' ').length,
      ),
    ).toBe(2);
    const lastCategory = page.locator('input[name="category"]').last();
    await lastCategory.focus();
    await expect(lastCategory).toBeFocused();
    await expect(lastCategory).toBeInViewport();
    await lastCategory.blur();
    await categoryScroll.evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect(
      page.getByRole('button', { name: 'Approve and continue to Neon' }),
    ).toBeInViewport();
    const bodyBox = await page.locator('.card-body').boundingBox();
    const footBox = await page.locator('.card-foot').boundingBox();
    expect(bodyBox && footBox).toBeTruthy();
    if (bodyBox && footBox) {
      expect(bodyBox.y + bodyBox.height).toBeLessThanOrEqual(footBox.y + 1);
    }
    await clearScreenshotInteractionState(page);
    await capture(page, 'B1-bare-editable');
  });

  test('B2 omitted resource and legacy read-only registration', async ({
    page,
    request,
  }) => {
    await openAuthorize(page, request);
    await capture(page, 'B2-omitted-resource');
    await openAuthorize(page, request, {}, { 'x-read-only': 'true' });
    await expect(page.locator('.scope-checkbox')).not.toBeChecked();
    await capture(page, 'B2-legacy-readonly-header');
  });

  test('B3 editable under scope=read has no write control', async ({
    page,
    request,
  }) => {
    await openAuthorize(page, request, { scope: 'read' });
    await expect(page.locator('.scope-checkbox')).toHaveCount(0);
    await expect(page.locator('[data-access-mode]')).toHaveText('Read-only');
    await capture(page, 'B3-editable-read-scope');
  });

  test('B4 one project and category subset with writes on then off', async ({
    page,
    request,
  }) => {
    await openAuthorize(page, request);
    await page.getByText('One project', { exact: true }).click();
    await page.locator('input[name="projectId"]').fill('proj-example');
    const categories = page.locator('input[name="category"]');
    const count = await categories.count();
    for (let i = 0; i < count; i += 1) {
      const box = categories.nth(i);
      const value = await box.getAttribute('value');
      const shouldCheck = value === 'querying' || value === 'schema';
      if (shouldCheck) {
        await box.check();
      } else {
        await box.uncheck();
      }
    }
    await expect(page.locator('[data-access-mode]')).toHaveText(
      'Read and write',
    );
    await clearScreenshotInteractionState(page);
    await capture(page, 'B4-subset-writes-on');
    await page.locator('.scope-checkbox').uncheck();
    await expect(page.locator('[data-access-mode]')).toHaveText('Read-only');
    await clearScreenshotInteractionState(page);
    await capture(page, 'B4-subset-writes-off');
  });

  test('B5 no categories all projects then one project', async ({
    page,
    request,
  }) => {
    await openAuthorize(page, request);
    const categories = page.locator('input[name="category"]');
    const count = await categories.count();
    for (let i = 0; i < count; i += 1) {
      await categories.nth(i).uncheck();
    }
    await expect(
      page.getByText(
        'With all projects selected, Search and Fetch remain available.',
      ),
    ).toBeVisible();
    await expect(page.getByText('Search', { exact: true })).toBeVisible();
    await clearScreenshotInteractionState(page);
    await capture(page, 'B5-no-categories-all-projects');
    await page.getByText('One project', { exact: true }).click();
    await page.locator('input[name="projectId"]').fill('proj-example');
    await expect(page.getByText('None.')).toBeVisible();
    await expect(
      page.getByText(
        'With all projects selected, Search and Fetch remain available.',
      ),
    ).toBeHidden();
    await clearScreenshotInteractionState(page);
    await capture(page, 'B5-no-categories-one-project');
  });

  test('B6 missing project ID shows a validation error', async ({
    page,
    request,
  }) => {
    await openAuthorize(page, request);
    await page.getByText('One project', { exact: true }).click();
    await page
      .getByRole('button', { name: 'Approve and continue to Neon' })
      .click();
    await expect(
      page.getByText('Enter the project ID this connection should use.'),
    ).toBeVisible();
    await expect(page.locator('input[name="projectId"]')).toBeFocused();
    await expect(page.locator('[role="alert"]')).toContainText(
      'Enter the project ID this connection should use.',
    );
    await capture(page, 'B6-missing-project-id');
  });

  test('B6 recovering from a project error keeps a growing tool preview accessible', async ({
    page,
    request,
  }) => {
    await openAuthorize(page, request);
    await page.getByText('One project', { exact: true }).click();
    await page.getByRole('button', { name: 'Clear categories' }).click();
    await page
      .getByRole('button', { name: 'Approve and continue to Neon' })
      .click();
    await expect(
      page.getByText('Enter the project ID this connection should use.'),
    ).toBeVisible();

    await page.locator('input[name="projectId"]').fill('proj-example');
    await page.getByRole('button', { name: 'Select all' }).click();

    const toggle = page.getByRole('button', { name: 'View tools' });
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(page.locator('[data-tool-scroll]')).toBeVisible();
  });

  test('B6 pressing Enter in Project ID approves instead of cancelling', async ({
    page,
    request,
  }) => {
    await openAuthorize(page, request);
    await page.getByText('One project', { exact: true }).click();
    const projectId = page.locator('input[name="projectId"]');
    await projectId.fill('proj-example');

    const submission = page.waitForRequest(
      (candidate) =>
        candidate.method() === 'POST' &&
        new URL(candidate.url()).pathname === '/api/authorize',
    );
    await projectId.press('Enter');
    const body = new URLSearchParams((await submission).postData() ?? '');

    expect(body.get('action')).toBe('approve');
  });

  test('B7 switching back to All projects keeps all-project access', async ({
    page,
    request,
  }) => {
    await openAuthorize(page, request);
    await page.getByText('One project', { exact: true }).click();
    await page.locator('input[name="projectId"]').fill('proj-example');
    await page
      .getByText('All projects you can access', { exact: true })
      .click();
    await expect(page.locator('input[name="projectId"]')).toBeDisabled();
    await clearScreenshotInteractionState(page);
    await capture(page, 'B7-switch-back-to-all-projects');
    const posted = await page.evaluate(() => {
      const form = document.querySelector('form');
      if (!(form instanceof HTMLFormElement)) {
        throw new Error('missing consent form');
      }
      return Array.from(new FormData(form).entries());
    });
    expect(posted).toContainEqual(['projectMode', 'all']);
    expect(
      posted.some(
        ([name, value]) => name === 'projectId' && value === 'proj-example',
      ),
    ).toBe(false);
  });

  test('T1 collapse uses visible tools only', async ({ page, request }) => {
    await openAuthorize(page, request);
    const categories = page.locator('input[name="category"]');
    const count = await categories.count();
    for (let i = 0; i < count; i += 1) {
      const box = categories.nth(i);
      if ((await box.getAttribute('value')) === 'snapshots') {
        await box.check();
      } else {
        await box.uncheck();
      }
    }
    await page.locator('.scope-checkbox').uncheck();
    await expect(page.getByRole('button', { name: 'View tools' })).toBeHidden();
    await clearScreenshotInteractionState(page);
    await capture(page, 'T1-visible-at-or-below-threshold');
    await page.locator('.scope-checkbox').check();
    await expect(
      page.getByRole('button', { name: 'View tools' }),
    ).toBeVisible();
    await clearScreenshotInteractionState(page);
    await capture(page, 'T1-above-threshold-after-writes');
  });

  test('T2 long list collapsed and expanded', async ({ page, request }) => {
    await openAuthorize(page, request);
    await expect(
      page.getByRole('button', { name: 'View tools' }),
    ).toBeVisible();
    await capture(page, 'T2-collapsed');
    await page.getByRole('button', { name: 'View tools' }).click();
    await expect(
      page.getByRole('button', { name: 'Hide tools' }),
    ).toBeVisible();
    await clearScreenshotInteractionState(page);
    await capture(page, 'T2-expanded');
    const toolScroll = page.locator('[data-tool-scroll]');
    await toolScroll.focus();
    await expect(toolScroll).toBeFocused();
    await page.keyboard.press('End');
    await expect(toolScroll.locator('li').last()).toBeInViewport();
  });

  test('L1 both modes at short desktop heights', async ({ page, request }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openAuthorize(page, request, {
      resource:
        'https://mcp.neon.tech/mcp?projectId=proj-example-with-a-very-long-identifier',
    });
    await expect(
      page.getByRole('button', { name: 'Approve and continue to Neon' }),
    ).toBeInViewport();
    await capture(page, 'L1-confirmation-720');
    const approve = page.getByRole('button', {
      name: 'Approve and continue to Neon',
    });
    await capture(page, 'L1-confirmation-720-actions');
    await page.setViewportSize({ width: 1280, height: 480 });
    await approve.scrollIntoViewIfNeeded();
    await capture(page, 'L1-confirmation-480-actions');
    await capture(page, 'L1-confirmation-480-full', true);

    await page.setViewportSize({ width: 1280, height: 720 });
    await openAuthorize(page, request);
    await page.getByRole('button', { name: 'View tools' }).click();
    const editableApprove = page.getByRole('button', {
      name: 'Approve and continue to Neon',
    });
    await expect(editableApprove).toBeInViewport();
    await capture(page, 'L1-editable-720-actions');
  });

  test('L2 mobile viewports', async ({ page, request }) => {
    await page.setViewportSize({ width: 390, height: 667 });
    await openAuthorize(page, request, {
      resource:
        'https://mcp.neon.tech/mcp?projectId=proj-example-with-a-very-long-identifier',
    });
    await capture(page, 'L2-mobile-portrait');
    await page.setViewportSize({ width: 667, height: 375 });
    await capture(page, 'L2-mobile-landscape');
    await page.setViewportSize({ width: 320, height: 568 });
    const narrowApprove = page.getByRole('button', {
      name: 'Approve and continue to Neon',
    });
    await expect(narrowApprove).toBeInViewport();
    await capture(page, 'L2-mobile-320px');
    await page.setViewportSize({ width: 390, height: 667 });
    await openAuthorize(page, request);
    await expect(
      page.getByRole('button', { name: 'Approve and continue to Neon' }),
    ).toBeInViewport();
    await capture(page, 'L2-editable-mobile-portrait');
  });

  test('L3 long client names keep consent actions reachable', async ({
    page,
    request,
  }) => {
    const longName = `Long OAuth client ${'name '.repeat(200)}`;
    const client = await registerClient(
      request,
      {},
      { ...VALID_REGISTER_PAYLOAD, client_name: longName },
    );
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(authorizePath(client));

    await expect(page.locator('h1')).toContainText(longName);
    await expect(
      page.getByRole('button', { name: 'Approve and continue to Neon' }),
    ).toBeInViewport();
    const headingBox = await page.locator('h1').boundingBox();
    expect(headingBox).toBeTruthy();
    expect(headingBox?.height).toBeLessThan(80);
  });

  test('consent page refuses to render in an iframe', async ({
    page,
    request,
  }) => {
    const client = await registerClient(request);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: VALID_REGISTER_PAYLOAD.redirect_uris[0],
      scope: 'read write',
      state: 'e2e-frame',
    });
    const authorizePath = `/api/authorize?${params.toString()}`;
    await page.setContent(
      `<iframe id="consent-frame" src="${authorizePath}"></iframe>`,
    );
    const frame = page.frame({ url: /\/api\/authorize/ });
    expect(frame).toBeNull();
  });
});
