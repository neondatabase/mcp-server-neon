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
export const COOKIE_SECRET = process.env.COOKIE_SECRET ?? '';

// Neon API configuration
export const NEON_API_HOST =
  process.env.NEON_API_HOST ?? 'https://console.neon.tech/api/v2';

// Where the docs tools read the documentation index from. Overridable so a run
// can be pointed at another origin; the e2e suite points it at a local fixture,
// which is what keeps a merge-gating test off the network. Individual doc pages
// still come from NEON_DOCS_BASE_URL in mcp/resources.ts.
export const NEON_DOCS_INDEX_URL =
  process.env.NEON_DOCS_INDEX_URL ?? 'https://neon.com/docs/llms.txt';

// Analytics and monitoring
export const ANALYTICS_WRITE_KEY =
  process.env.ANALYTICS_WRITE_KEY ?? 'gFVzt8ozOp6AZRXoD0g0Lv6UQ6aaoS7O';
export const SENTRY_DSN =
  process.env.SENTRY_DSN ??
  'https://b3564134667aa2dfeaa3992a12d9c12f@o1373725.ingest.us.sentry.io/4509328350380033';

// Environment
export type Environment = 'development' | 'production' | 'preview';

// Encoding for row-shaped tool results: 'json' (default) or 'gcf' (Graph Compact Format,
// fewer tokens for query results, lossless). Off by default; requires the optional
// @blackwell-systems/gcf dependency. See mcp/tools/gcf-format.ts.
export const RESPONSE_FORMAT: 'json' | 'gcf' =
  process.env.NEON_MCP_RESPONSE_FORMAT === 'gcf' ? 'gcf' : 'json';

// Derived values
export const NEON_CONSOLE_HOST = NEON_API_HOST.replace(/\/api\/v2$/, '');
