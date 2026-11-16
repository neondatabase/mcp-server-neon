import { HERO_VIDEO_ORIGIN } from './hero-video';
import { MARKDOWN_PATH } from './links';
import { renderLandingMarkdown } from './markdown';
import { renderLandingPage } from './page';
import { landingPageFormat } from './request';

export { isLandingPageRequest } from './request';

const contentSecurityPolicy = (nonce: string): string =>
  [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self'",
    "font-src 'self'",
    `media-src ${HERO_VIDEO_ORIGIN}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');

const LANDING_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  Vary: 'Accept, Authorization',
};

export const landingMarkdownResponse = (req: Request): Response =>
  new Response(req.method === 'HEAD' ? null : renderLandingMarkdown(), {
    status: 200,
    headers: {
      ...LANDING_HEADERS,
      'Content-Type': 'text/markdown; charset=utf-8',
    },
  });

const landingHtmlResponse = (req: Request): Response => {
  const nonce = Buffer.from(
    crypto.getRandomValues(new Uint8Array(16)),
  ).toString('base64');

  return new Response(req.method === 'HEAD' ? null : renderLandingPage(nonce), {
    status: 200,
    headers: {
      ...LANDING_HEADERS,
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': contentSecurityPolicy(nonce),
      Link: `<${MARKDOWN_PATH}>; rel="alternate"; type="text/markdown"`,
    },
  });
};

export const landingPageResponse = (req: Request): Response =>
  landingPageFormat(req) === 'markdown'
    ? landingMarkdownResponse(req)
    : landingHtmlResponse(req);
