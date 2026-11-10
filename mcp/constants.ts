/**
 * Constants for the MCP server.
 * Re-exports centralized config values.
 */

// Re-export all config values from centralized config
export {
  NEON_API_HOST,
  ANALYTICS_WRITE_KEY,
  SENTRY_DSN,
  type Environment,
} from '../lib/config';
