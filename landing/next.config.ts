import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  experimental: {
    serverComponentsExternalPackages: ["@tailwindcss/oxide"],
  },
};

export default nextConfig;
