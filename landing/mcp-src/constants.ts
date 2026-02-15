/**
 * Constants for the MCP server.
 * Re-exports centralized config values and adds MCP-specific constants.
 */

// Re-export all config values from centralized config
export {
  NEON_API_HOST,
  ANALYTICS_WRITE_KEY,
  SENTRY_DSN,
  NEON_CONSOLE_HOST,
  type Environment,
} from '../lib/config';

// MCP-specific constants
export const NEON_DEFAULT_DATABASE_NAME = 'neondb';
