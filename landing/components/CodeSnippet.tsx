'use client';

import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { docco } from 'react-syntax-highlighter/dist/esm/styles/hljs';

const SyntaxHighlighter = dynamic(() => import('react-syntax-highlighter'));

type Props = {
  type?: string;
  children: string;
};

export const CodeSnippet = ({ type, children }: Props) => (
  <div className="my-2">
    <Suspense
      fallback={
        <div className="monospaced whitespace-pre-wrap bg-secondary px-2 py-[0.5em] border-l-4">
          {children}
        </div>
      }
    >
      <SyntaxHighlighter language={type} style={docco}>
        {children}
      </SyntaxHighlighter>
    </Suspense>
  </div>
);
