import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Serverless deployment on Vercel - do not use 'export' mode
  // API routes require dynamic server-side rendering

  // Redirect root path to Neon docs (single source of truth; there is no landing page)
  async redirects() {
    return [
      {
        source: '/',
        destination: 'https://neon.com/docs/ai/neon-mcp-server',
        permanent: true,
      },
    ];
  },

  // Public paths → App Router handlers. `/mcp` is the live transport.
  // `/sse` and `/message` still rewrite so retired clients get the 410 body
  // instead of a Next 404.
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
        source: '/message',
        destination: '/api/message',
      },
      {
        source: '/health',
        destination: '/api/health',
      },
    ];
  },
};

export default nextConfig;
