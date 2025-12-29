/**
 * Constants for the MCP server.
 * Re-exports centralized config values and adds MCP-specific constants.
 */

// Re-export all config values from centralized config
export {
  SERVER_HOST,
  UPSTREAM_OAUTH_HOST,
  CLIENT_ID,
  CLIENT_SECRET,
  COOKIE_SECRET,
  NEON_API_HOST,
  ANALYTICS_WRITE_KEY,
  SENTRY_DSN,
  NODE_ENV,
  NEON_CONSOLE_HOST,
  type Environment,
} from '../lib/config';

// MCP-specific constants
export const NEON_DEFAULT_DATABASE_NAME = 'neondb';
