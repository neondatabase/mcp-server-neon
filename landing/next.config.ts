import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Serverless deployment on Vercel - do not use 'export' mode
  // API routes require dynamic server-side rendering

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
