import { config } from 'dotenv';

config();

export const NEON_DEFAULT_ROLE_NAME = 'neondb_owner';
export const NEON_DEFAULT_DATABASE_NAME = 'neondb';

export const IS_DEV = process.env.NODE_ENV === 'development';
export const SERVER_PORT = 3001;
export const SERVER_HOST =
  process.env.SERVER_HOST ?? `http://localhost:${SERVER_PORT}`;
export const CLIENT_ID = process.env.CLIENT_ID ?? '';
export const CLIENT_SECRET = process.env.CLIENT_SECRET ?? '';
export const UPSTREAM_OAUTH_HOST =
  process.env.UPSTREAM_OAUTH_HOST ?? 'https://oauth2.neon.tech';
export const REDIRECT_URI =
  process.env.REDIRECT_URI ?? `${SERVER_HOST}/callback`;
export const NEON_API_HOST = process.env.NEON_API_HOST ?? '';
