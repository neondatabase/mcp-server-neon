/**
 * Configuration for the Vercel deployment.
 * Uses VERCEL_URL as fallback for preview deployments.
 */

export const SERVER_HOST =
  process.env.SERVER_HOST ||
  (process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000');

export const UPSTREAM_OAUTH_HOST =
  process.env.UPSTREAM_OAUTH_HOST ?? 'https://oauth2.neon.tech';

export const CLIENT_ID = process.env.CLIENT_ID ?? '';
export const CLIENT_SECRET = process.env.CLIENT_SECRET ?? '';
export const COOKIE_SECRET = process.env.COOKIE_SECRET ?? '';
