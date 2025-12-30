import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';

import { ThemeProvider } from '@/components/ThemeProvider';

import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Neon MCP Server',
  description:
    'Connect your AI tools to Neon Postgres databases using the Model Context Protocol. Manage databases, run migrations, and optimize queries through natural language.',
  metadataBase: new URL('https://mcp.neon.tech'),
  icons: {
    icon: '/favicon.ico',
  },
  openGraph: {
    title: 'Neon MCP Server',
    description:
      'Connect your AI tools to Neon Postgres databases using the Model Context Protocol. Manage databases, run migrations, and optimize queries through natural language.',
    url: 'https://mcp.neon.tech',
    siteName: 'Neon MCP Server',
    images: [
      {
        url: '/logo.png',
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
    images: ['/logo.png'],
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
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
