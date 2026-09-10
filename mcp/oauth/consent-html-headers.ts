export const CONSENT_HTML_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "frame-ancestors 'none'",
} as const;

export const AUTH_RESTART_DESCRIPTION =
  'This authorization request expired or is invalid. Start authorization again from your client.';
