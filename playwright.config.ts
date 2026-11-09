import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import {
  DOCS_FIXTURE_BASE_URL,
  FEEDBACK_FIXTURE_URL,
  SITE_SEARCH_FIXTURE_URL,
} from './e2e/docs-fixture.js';
import { SENTRY_FIXTURE_DSN } from './e2e/sentry-fixture.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.E2E_PORT ?? '3100';
const BASE_URL = `http://localhost:${PORT}`;

/**
 * Load env vars from .env.e2e (written by e2e setup).
 * These are passed to the webServer so the Next.js dev server
 * has a working OAUTH_DATABASE_URL.
 */
function loadE2eEnv(): Record<string, string> {
  const envFile = path.resolve(__dirname, '.env.e2e');
  if (!existsSync(envFile)) return {};

  const parsed = dotenv.config({ path: envFile, processEnv: {} });
  return (parsed.parsed as Record<string, string>) ?? {};
}

export default defineConfig({
  globalSetup: './e2e/global-setup.ts',
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // Production's request URL host is mcp.neon.tech. A loopback hostname
    // here would absorb NextRequest's one loopback-to-localhost rewrite and
    // hide what it does to a loopback redirect_uri (see next.config.ts).
    command: `pnpm exec next dev --hostname 0.0.0.0 --port ${PORT}`,
    url: BASE_URL,
    // The suite owns this server so webServer.env always reaches it.
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      // Load fresh values from .env.e2e for the webServer subprocess.
      ...loadE2eEnv(),
      SERVER_HOST: BASE_URL,
      // Serve doc pages from the fixture server that global setup starts, so
      // no merge-gating test depends on neon.com being reachable. Set here and
      // not in global setup: Playwright starts the web server as a plugin task,
      // which runs before global setup, so anything global setup puts on
      // process.env arrives too late for this process.
      NEON_DOCS_BASE_URL: DOCS_FIXTURE_BASE_URL,
      // Same fixture server, so send_feedback never reaches the real service.
      NEON_FEEDBACK_URL: FEEDBACK_FIXTURE_URL,
      // Same fixture server for search_docs, so no test depends on neon-agent.
      NEON_SITE_SEARCH_URL: SITE_SEARCH_FIXTURE_URL,
      // An unset SENTRY_DSN falls back to the production DSN in lib/config.ts,
      // and the suite triggers server errors on purpose. The fixture also
      // lets tests read the spans and logs the server sends.
      SENTRY_DSN: SENTRY_FIXTURE_DSN,
      // An unset ANALYTICS_WRITE_KEY falls back to the production key, so test
      // traffic would otherwise land in production analytics.
      NEON_MCP_DISABLE_ANALYTICS: '1',
    },
  },
});
