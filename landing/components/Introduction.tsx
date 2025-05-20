import { cn } from '@/lib/utils';
import { ExternalLink } from '@/components/ExternalLink';

export const Introduction = ({ className }: { className?: string }) => (
  <div className={cn('flex flex-col gap-2', className)}>
    <desc className="text-xl mb-2">
      Manage your Neon Postgres databases with natural language.
    </desc>

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
  </div>
);
