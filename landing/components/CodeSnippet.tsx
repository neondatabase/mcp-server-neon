'use client';

import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import {
  docco,
  stackoverflowDark,
} from 'react-syntax-highlighter/dist/esm/styles/hljs';
import { useTheme } from '@/components/ThemeProvider';

const SyntaxHighlighter = dynamic(
  () => import('react-syntax-highlighter').then((module) => module.default),
  {
    ssr: false,
  },
);

type Props = {
  type?: string;
  children: string;
};

export const CodeSnippet = ({ type, children }: Props) => {
  const theme = useTheme();

  return (
    <div className="my-2">
      <Suspense
        fallback={
          <div className="monospaced whitespace-pre-wrap bg-secondary px-2 py-[0.5em] border-l-4">
            {children}
          </div>
        }
      >
        <SyntaxHighlighter
          language={type}
          wrapLongLines
          style={theme === 'light' ? docco : stackoverflowDark}
        >
          {children}
        </SyntaxHighlighter>
      </Suspense>
    </div>
  );
};
