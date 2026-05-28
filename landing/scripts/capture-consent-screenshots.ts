/**
 * Capture marketing screenshots of the OAuth consent UI for the PR
 * description. Run via: pnpm exec tsx scripts/capture-consent-screenshots.ts
 *
 * Requirements:
 *   - A Next.js dev server reachable at $BASE_URL (defaults to
 *     http://localhost:3100)
 *   - A working OAUTH_DATABASE_URL + COOKIE_SECRET in the dev server's
 *     environment
 */

import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3100';
const OUT_DIR = process.env.OUT_DIR ?? '/tmp/consent-screenshots';

const REGISTER_PAYLOAD = {
  client_name: 'Codex CLI',
  client_uri: 'https://github.com/cursor/codex',
  redirect_uris: ['http://127.0.0.1:55667/callback'],
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',
} as const;

async function registerClient(): Promise<{
  client_id: string;
  client_secret: string;
}> {
  const res = await fetch(`${BASE_URL}/api/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(REGISTER_PAYLOAD),
  });
  if (!res.ok) {
    throw new Error(`register failed ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as { client_id: string; client_secret: string };
}

async function fetchConsentUrl(
  clientId: string,
  authorizeParams: Record<string, string> = {},
): Promise<string> {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REGISTER_PAYLOAD.redirect_uris[0],
    scope: 'read write',
    state: 'screenshot',
    ...authorizeParams,
  });

  const res = await fetch(`${BASE_URL}/api/authorize?${params.toString()}`, {
    redirect: 'manual',
  });
  if (res.status !== 307 && res.status !== 302) {
    throw new Error(`expected 307 from /api/authorize, got ${res.status}`);
  }
  const loc = res.headers.get('location');
  if (!loc) {
    throw new Error('expected location header on /api/authorize redirect');
  }
  return loc;
}

const SCENARIOS: Array<{
  name: string;
  description: string;
  authorizeParams?: Record<string, string>;
  beforeShot?: (
    page: import('@playwright/test').Page,
  ) => Promise<void>;
}> = [
  {
    name: '01-default-full-access',
    description: 'Default state: full access requested, all 7 categories',
  },
  {
    name: '02-narrowed-categories',
    description:
      'User narrows to Querying + Schema and pins a project ID — preview reflects the change',
    beforeShot: async (page) => {
      // Toggle off everything except Querying and Schema.
      await page.getByRole('button', { name: 'Clear all' }).click();
      await page.getByRole('checkbox', { name: /Querying/ }).check();
      await page.getByRole('checkbox', { name: /Schema/ }).check();
      await page.getByLabel('Project ID').fill('prj_demo_42');
      await page.waitForTimeout(800);
    },
  },
  {
    name: '03-read-only-mode',
    description: 'User toggles to Read-only — preview prunes destructive tools',
    beforeShot: async (page) => {
      await page.getByRole('radio', { name: 'Read-only' }).click();
      await page.waitForTimeout(800);
    },
  },
  {
    name: '04-client-pinned-project',
    description:
      'MCP client pinned a project ID via resource URI — input is locked',
    authorizeParams: {
      resource: 'https://mcp.neon.tech/mcp?projectId=prj_pinned_demo',
    },
  },
  {
    name: '05-client-pinned-categories',
    description:
      'MCP client capped categories to Querying+Schema via resource URI — only those two render',
    authorizeParams: {
      resource:
        'https://mcp.neon.tech/mcp?category=querying&category=schema',
    },
  },
  {
    name: '06-readonly-locked',
    description:
      'MCP client mandated read-only via ?readonly=true — Full access is disabled',
    authorizeParams: {
      resource: 'https://mcp.neon.tech/mcp?readonly=true',
      scope: 'read',
    },
  },
];

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 920, height: 1320 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });

  for (const scenario of SCENARIOS) {
    const client = await registerClient();
    const consentUrl = await fetchConsentUrl(
      client.client_id,
      scenario.authorizeParams,
    );

    const page = await context.newPage();
    await page.goto(consentUrl, { waitUntil: 'networkidle' });
    await page.waitForSelector('text=Authorize Codex CLI');
    // Let the live preview's debounced fetch settle.
    await page.waitForTimeout(800);

    if (scenario.beforeShot) {
      await scenario.beforeShot(page);
    }

    const out = path.join(OUT_DIR, `${scenario.name}.png`);
    await page.screenshot({
      path: out,
      fullPage: true,
    });
    console.log(`[shot] ${out}  — ${scenario.description}`);
    await page.close();
  }

  await context.close();
  await browser.close();
}

main().catch((err) => {
  console.error('Screenshot capture failed:', err);
  process.exit(1);
});
