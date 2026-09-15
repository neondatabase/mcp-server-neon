/**
 * Global setup for Playwright E2E tests.
 *
 * Provisions an ephemeral Postgres database via Instagres (neon.new)
 * and writes the connection string to .env.e2e for the Next.js dev server.
 *
 * The database expires after 72 hours, so no explicit teardown is needed.
 */

import { ensureOauthDatabaseUrl } from './provision-oauth-db.js';
import {
  DOCS_FIXTURE_INDEX_URL,
  startDocsFixtureServer,
} from './docs-fixture.js';

export default async function globalSetup() {
  const connectionString = await ensureOauthDatabaseUrl();
  process.env.OAUTH_DATABASE_URL = connectionString;

  const docsServer = await startDocsFixtureServer();
  console.log(
    `[e2e-setup] Serving the docs index fixture on ${DOCS_FIXTURE_INDEX_URL}`,
  );

  return async () => {
    await new Promise<void>((resolve) => docsServer.close(() => resolve()));
  };
}
