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
  IS_DEV,
  NEON_CONSOLE_HOST,
  type Environment,
} from '../lib/config';

// MCP-specific constants
export const NEON_DEFAULT_DATABASE_NAME = 'neondb';
export const SERVER_PORT = 3001;

// Derived values for backwards compatibility
import { SERVER_HOST } from '../lib/config';
export const REDIRECT_URI = `${SERVER_HOST}/callback`;
