import { test, expect } from '@playwright/test';
import {
  capture,
  openAuthorize,
  registerClient,
  VALID_REGISTER_PAYLOAD,
} from './oauth-helpers';

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
    await expect(page.getByText('Ignored category values')).toBeVisible();
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
    await openAuthorize(page, request, {
      resource: 'https://mcp.neon.tech/mcp',
    });
    await expect(page.locator('.scope-checkbox')).toBeChecked();
    await expect(page.locator('[data-project-id-field]')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Show' })).toBeVisible();
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
    await expect(page.locator('[data-tools-summary]')).toContainText(
      'read and write',
    );
    await capture(page, 'B4-subset-writes-on');
    await page.locator('.scope-checkbox').uncheck();
    await expect(page.locator('[data-tools-summary]')).toContainText(
      'read-only',
    );
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
    await expect(page.getByText('Search')).toBeVisible();
    await capture(page, 'B5-no-categories-all-projects');
    await page.getByText('One project', { exact: true }).click();
    await page.locator('input[name="projectId"]').fill('proj-example');
    await expect(page.getByText('None.')).toBeVisible();
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
    await capture(page, 'B6-missing-project-id');
  });

  test('B7 switching back to All projects keeps all-project access', async ({
    page,
    request,
  }) => {
    await openAuthorize(page, request);
    await page.getByText('One project', { exact: true }).click();
    await page.locator('input[name="projectId"]').fill('proj-example');
    await page.getByText('All projects', { exact: true }).click();
    await expect(page.locator('input[name="projectId"]')).toBeDisabled();
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
      if ((await box.getAttribute('value')) === 'branches') {
        await box.check();
      } else {
        await box.uncheck();
      }
    }
    await page.locator('.scope-checkbox').uncheck();
    await expect(page.getByRole('button', { name: 'Show' })).toBeHidden();
    await capture(page, 'T1-visible-at-or-below-threshold');
    await page.locator('.scope-checkbox').check();
    await expect(page.getByRole('button', { name: 'Show' })).toBeVisible();
    await capture(page, 'T1-above-threshold-after-writes');
  });

  test('T2 long list collapsed and expanded', async ({ page, request }) => {
    await openAuthorize(page, request);
    await expect(page.getByRole('button', { name: 'Show' })).toBeVisible();
    await capture(page, 'T2-collapsed');
    await page.getByRole('button', { name: 'Show' }).click();
    await expect(page.getByRole('button', { name: 'Hide' })).toBeVisible();
    await capture(page, 'T2-expanded');
  });

  test('L1 both modes at short desktop heights', async ({ page, request }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openAuthorize(page, request, {
      resource:
        'https://mcp.neon.tech/mcp?projectId=proj-example-with-a-very-long-identifier',
    });
    await capture(page, 'L1-confirmation-720');
    const approve = page.getByRole('button', {
      name: 'Approve and continue to Neon',
    });
    await approve.scrollIntoViewIfNeeded();
    await capture(page, 'L1-confirmation-720-actions');
    await page.setViewportSize({ width: 1280, height: 480 });
    await approve.scrollIntoViewIfNeeded();
    await capture(page, 'L1-confirmation-480-actions');
    await capture(page, 'L1-confirmation-480-full', true);

    await page.setViewportSize({ width: 1280, height: 720 });
    await openAuthorize(page, request);
    await page.getByRole('button', { name: 'Show' }).click();
    const editableApprove = page.getByRole('button', {
      name: 'Approve and continue to Neon',
    });
    await editableApprove.scrollIntoViewIfNeeded();
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
    await page.evaluate(() => {
      document.documentElement.style.zoom = '2';
    });
    await capture(page, 'L2-mobile-200-zoom');
    await page.evaluate(() => {
      document.documentElement.style.zoom = '1';
    });
    await page.setViewportSize({ width: 390, height: 667 });
    await openAuthorize(page, request);
    await capture(page, 'L2-editable-mobile-portrait');
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
