'use client';

import { useState } from 'react';

export const CopyableCommand = ({ command }: { command: string }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <code
      onClick={handleCopy}
      className="bg-white px-2 py-0.5 rounded text-sm border border-blue-200 text-gray-800 cursor-pointer hover:bg-blue-50 transition-colors"
      title="Click to copy"
    >
      {copied ? 'Copied!' : command}
    </code>
  );
};
