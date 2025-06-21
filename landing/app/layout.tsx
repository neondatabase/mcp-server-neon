import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import Head from 'next/head';

import { ThemeProvider } from '@/components/ThemeProvider';

import './globals.css';

export const metadata: Metadata = {
  title: 'Neon MCP',
  description: 'Learn how to use Neon MCP',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <Head>
        <link rel="icon" href="/favicon.ico" type="image/x-icon" />
      </Head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
