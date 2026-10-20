/**
 * Centralized configuration for the Vercel deployment.
 * This is the single source of truth for all configuration values.
 */

// Server host detection
export const SERVER_HOST =
  process.env.SERVER_HOST ||
  (process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000');

// OAuth configuration
export const UPSTREAM_OAUTH_HOST =
  process.env.UPSTREAM_OAUTH_HOST ?? 'https://oauth2.neon.tech';
export const CLIENT_ID = process.env.CLIENT_ID ?? '';
export const CLIENT_SECRET = process.env.CLIENT_SECRET ?? '';

// Neon API configuration
export const NEON_API_HOST =
  process.env.NEON_API_HOST ?? 'https://console.neon.tech/api/v2';

// Where get_doc reads page markdown from (`<base>/<slug>.md`). Overridable so
// the e2e suite can serve pages from a local fixture and stay off the network.
export const NEON_DOCS_BASE_URL =
  process.env.NEON_DOCS_BASE_URL ?? 'https://neon.com';

// Where search_docs posts to: neon-agent's site search (the assistant Neon
// Function), which also backs the neon.com search box. Overridable so the e2e
// suite can point it at a local fixture.
export const NEON_SITE_SEARCH_URL =
  process.env.NEON_SITE_SEARCH_URL ??
  'https://br-frosty-cell-a5smzg39-assistant.compute.c-1.us-east-2.aws.neon.tech/site-search';

// Where send_feedback posts to (the neondatabase/neon-feedback Function).
// Overridable so tests and local runs never send real feedback.
export const NEON_FEEDBACK_URL =
  process.env.NEON_FEEDBACK_URL ?? 'https://feedback.neon.tech/';

// Analytics and monitoring
export const ANALYTICS_WRITE_KEY =
  process.env.ANALYTICS_WRITE_KEY ?? 'gFVzt8ozOp6AZRXoD0g0Lv6UQ6aaoS7O';
export const SENTRY_DSN =
  process.env.SENTRY_DSN ??
  'https://b3564134667aa2dfeaa3992a12d9c12f@o1373725.ingest.us.sentry.io/4509328350380033';

// Environment
export type Environment = 'development' | 'production' | 'preview';

// Derived values
export const NEON_CONSOLE_HOST = NEON_API_HOST.replace(/\/api\/v2$/, '');
