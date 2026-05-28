import type { NextConfig } from 'next';

// Clickjacking-prevention headers required by the MCP Security Best
// Practices document for OAuth consent UIs (Confused Deputy mitigation
// → Consent UI Requirements). The consent screen MUST refuse to be
// iframed; we set both X-Frame-Options and CSP frame-ancestors for
// belt-and-suspenders coverage across browsers that disagree on
// precedence.
const CONSENT_SECURITY_HEADERS = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'Referrer-Policy', value: 'no-referrer' },
];

const nextConfig: NextConfig = {
  // Serverless deployment on Vercel - do not use 'export' mode
  // API routes require dynamic server-side rendering

  // Hide the floating "Next.js" dev indicator. It clashes with the brand
  // surface in screenshots and brings no value at mcp.neon.tech where
  // the consent UI is the only user-facing page.
  devIndicators: false,

  async redirects() {
    return [
      {
        source: '/',
        destination: 'https://neon.tech/docs/ai/neon-mcp-server',
        permanent: true,
      },
    ];
  },

  // Backwards compatibility: old routes → new API routes
  async rewrites() {
    return [
      {
        source: '/mcp',
        destination: '/api/mcp',
      },
      {
        source: '/sse',
        destination: '/api/sse',
      },
      {
        source: '/health',
        destination: '/api/health',
      },
    ];
  },

  async headers() {
    return [
      {
        source: '/oauth/consent/:path*',
        headers: CONSENT_SECURITY_HEADERS,
      },
      {
        source: '/oauth/consent',
        headers: CONSENT_SECURITY_HEADERS,
      },
      {
        source: '/api/authorize',
        headers: CONSENT_SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
