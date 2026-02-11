import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.E2E_PORT ?? '3100';
const BASE_URL = `http://localhost:${PORT}`;

/**
 * Load env vars from .env.e2e (written by global-setup.ts).
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
    command: `bun run dev -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    // Env vars are set by globalSetup on process.env, which the webServer
    // subprocess inherits. We also try to load .env.e2e here for the case
    // where it already exists from a previous run.
    env: loadE2eEnv(),
  },
});
