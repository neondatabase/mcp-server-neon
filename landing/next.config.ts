import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  serverExternalPackages: ['@tailwindcss/oxide'],
};

export default nextConfig;
