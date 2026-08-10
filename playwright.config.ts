import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { DOCS_FIXTURE_INDEX_URL } from './e2e/docs-fixture.js';

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
    command: `pnpm exec next dev --port ${PORT}`,
    url: BASE_URL,
    // The suite owns this server so webServer.env always reaches it.
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      // Load fresh values from .env.e2e for the webServer subprocess.
      ...loadE2eEnv(),
      // Read the docs index from the fixture server that global setup starts, so
      // no merge-gating test depends on neon.com being reachable. Set here and
      // not in global setup: Playwright starts the web server as a plugin task,
      // which runs before global setup, so anything global setup puts on
      // process.env arrives too late for this process.
      NEON_DOCS_INDEX_URL: DOCS_FIXTURE_INDEX_URL,
    },
  },
});
