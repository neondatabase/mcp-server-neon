import { config } from 'dotenv';

config();

export type Environment = 'development' | 'production' | 'preview';
export const NEON_DEFAULT_DATABASE_NAME = 'neondb';

export const NODE_ENV = (process.env.NODE_ENV ?? 'production') as Environment;
export const IS_DEV = NODE_ENV === 'development';
export const SERVER_PORT = 3001;
export const SERVER_HOST =
  process.env.SERVER_HOST ?? `http://localhost:${SERVER_PORT}`;
export const CLIENT_ID = process.env.CLIENT_ID ?? '';
export const CLIENT_SECRET = process.env.CLIENT_SECRET ?? '';
export const UPSTREAM_OAUTH_HOST =
  process.env.UPSTREAM_OAUTH_HOST ?? 'https://oauth2.neon.tech';
export const REDIRECT_URI = `${SERVER_HOST}/callback`;
export const NEON_API_HOST =
  process.env.NEON_API_HOST ?? 'https://console.neon.tech/api/v2';
export const COOKIE_SECRET = process.env.COOKIE_SECRET ?? '';
export const ANALYTICS_WRITE_KEY =
  process.env.ANALYTICS_WRITE_KEY ?? 'gFVzt8ozOp6AZRXoD0g0Lv6UQ6aaoS7O';
export const SENTRY_DSN = process.env.SENTRY_DSN ?? '';
