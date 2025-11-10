import Image from 'next/image';

import { cn } from '@/lib/utils';
import { ExternalLink } from '@/components/ExternalLink';
import { CopyableUrl } from '@/components/CopyableUrl';

export const Introduction = ({ className }: { className?: string }) => (
  <div className={cn('flex flex-col gap-2', className)}>
    <desc className="text-xl mb-2">
      Manage your Neon Postgres databases with natural language.
    </desc>

    <CopyableUrl url="https://mcp.neon.tech/mcp" />

    <div>
      The <strong className="font-semibold">Neon MCP Server</strong> lets AI
      agents and dev tools like Cursor interact with Neon by translating plain
      English into{' '}
      <ExternalLink href="https://api-docs.neon.tech/reference/getting-started-with-neon-api">
        Neon API
      </ExternalLink>{' '}
      calls—no code required. You can create databases, run queries, and make
      schema changes just by typing commands like "Create a database named
      'my-new-database'" or "List all my Neon projects".
    </div>
    <div>
      Built on the{' '}
      <ExternalLink href="https://modelcontextprotocol.org/">
        Model Context Protocol (MCP)
      </ExternalLink>
      , the server bridges natural language and the Neon API to support actions
      like creating projects, managing branches, running queries, and handling
      migrations.
      <br />
      <ExternalLink href="https://neon.tech/docs/ai/neon-mcp-server">
        Learn more in the docs
      </ExternalLink>
    </div>

    <div className="mt-4">
      <h3 className="text-lg font-semibold mb-2">Read-Only Version</h3>
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-sm mb-2">
            Safe for cloud environments. All transactions are read-only - perfect for querying and analyzing data without modification risks.
          </p>
          <p className="text-xs text-gray-600">
            Enable read-only mode by adding the <code className="bg-gray-100 px-1 py-0.5 rounded text-xs">x-read-only: true</code> header in your MCP configuration.
          </p>
        </div>
        <a
          href="https://cursor.com/en-US/install-mcp?name=Neon%20MCP%20Server&config=eyJ1cmwiOiJodHRwOi8vbWNwLm5lb24udGVjaC9tY3AiLCJoZWFkZXJzIjp7IngtcmVhZC1vbmx5IjoidHJ1ZSJ9fQ%3D%3D"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Image
            alt="Add to Cursor"
            src="https://cursor.com/deeplink/mcp-install-light.svg"
            className="invert dark:invert-0"
            width={126}
            height={32}
          />
        </a>
      </div>
    </div>
  </div>
);
