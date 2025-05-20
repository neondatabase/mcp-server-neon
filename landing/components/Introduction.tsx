import { cn } from '@/lib/utils';
import { ExternalLink } from '@/components/ExternalLink';

export const Introduction = ({ className }: { className?: string }) => (
  <div className={cn('flex flex-col gap-2', className)}>
    <desc className="text-xl">
      Manage your Neon Postgres databases using natural language commands with
      the Neon MCP Server.
    </desc>
    <div>
      The <strong className="font-semibold">Neon MCP Server</strong> is an
      open-source tool that lets AI agents and dev tools like Cursor interact
      with Neon Postgres using natural language. It translates plain English
      into Neon API actions, making it easy to manage database, run queries, and
      handle schema changes—no code needed. <br />
      <ExternalLink href="https://neon.tech/docs/ai/neon-mcp-server">
        Learn more in the docs
      </ExternalLink>
    </div>
    <div>
      Imagine you want to create a new database. Instead of using the Neon
      Console or API, you could just type a request like, "Create a database
      named 'my-new-database'". Or, to see your projects, you might ask, "List
      all my Neon projects". The Neon MCP Server makes this possible.
    </div>
    <div>
      It works by acting as a bridge between natural language requests and the{' '}
      <ExternalLink href="https://api-docs.neon.tech/reference/getting-started-with-neon-api">
        Neon API
      </ExternalLink>
      . Built upon the{' '}
      <ExternalLink href="https://modelcontextprotocol.org/">
        Model Context Protocol (MCP)
      </ExternalLink>
      , it translates your requests into the necessary Neon API calls, allowing
      you to manage everything from creating projects and branches to running
      queries and performing database migrations.
    </div>
  </div>
);
