import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Serverless deployment on Vercel - do not use 'export' mode
  // API routes require dynamic server-side rendering

  // Redirect landing page to Neon docs (single source of truth)
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
  // This allows existing MCP client configurations to continue working
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
};

export default nextConfig;
