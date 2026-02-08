import type { ReactNode } from 'react';
import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'Neon MCP Server',
  description:
    'Connect your AI tools to Neon Postgres databases using the Model Context Protocol. Manage databases, run migrations, and optimize queries through natural language.',
  metadataBase: new URL('https://mcp.neon.tech'),
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico', sizes: '32x32' },
    ],
    apple: '/apple-touch-icon.png',
  },
  openGraph: {
    title: 'Neon MCP Server',
    description:
      'Connect your AI tools to Neon Postgres databases using the Model Context Protocol. Manage databases, run migrations, and optimize queries through natural language.',
    url: 'https://mcp.neon.tech',
    siteName: 'Neon MCP Server',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Neon MCP Server',
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Neon MCP Server',
    description:
      'Connect your AI tools to Neon Postgres databases using the Model Context Protocol.',
    images: ['/og-image.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
  alternates: {
    canonical: 'https://mcp.neon.tech',
  },
  authors: [{ name: 'Neon', url: 'https://neon.tech' }],
  creator: 'Neon',
  publisher: 'Neon',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
