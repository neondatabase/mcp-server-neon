"use client";

import { useState } from "react";

export const CopyableUrl = ({ url }: { url: string }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <div className="my-2 relative">
      <div className="monospaced whitespace-pre-wrap bg-secondary px-3 py-2 border-l-4 border-primary/20 rounded-r-md flex items-center justify-between group">
        <span className="text-sm">{url}</span>
        <button
          onClick={handleCopy}
          className="ml-3 px-2 py-1 text-xs bg-primary/10 hover:bg-primary/20 rounded transition-colors opacity-0 group-hover:opacity-100"
          title="Copy to clipboard"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
    </div>
  );
};
