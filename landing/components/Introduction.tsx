import { cn } from '@/lib/utils';
import { ExternalLink } from '@/components/ExternalLink';
import { CopyableUrl } from '@/components/CopyableUrl';
import { CopyableCommand } from '@/components/CopyableCommand';

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

    <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-lg p-4 my-2">
      <p className="text-sm text-gray-800">
        <strong className="font-semibold text-gray-900">Quick setup:</strong>{' '}
        Run{' '}
        <code className="bg-white px-2 py-0.5 rounded text-sm border border-emerald-200 text-gray-800">
          npx neonctl@latest init
        </code>{' '}
        to authenticate via OAuth, automatically create a Neon API key, and
        configure Cursor, VS Code, or Claude Code CLI to connect to the Neon MCP
        Server. Then ask your AI assistant "Get started with Neon".{' '}
        <ExternalLink href="https://neon.tech/docs/reference/cli-init">
          Learn more in the docs
        </ExternalLink>
      </p>
    </div>

    <div className="mt-4">
      <h3 className="text-lg font-semibold mb-2">Read-Only Mode</h3>
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-sm mb-2">
            Restricts available tools to read-only operations like listing
            projects, describing schemas, and viewing data. Write operations
            like creating projects, branches, or running migrations are
            disabled.
          </p>
          <p className="text-xs text-muted-foreground">
            Enable via OAuth (uncheck &quot;Full access&quot; during
            authorization) or add the{' '}
            <code className="bg-muted px-1 py-0.5 rounded text-xs">
              x-read-only: true
            </code>{' '}
            header in your MCP configuration.
          </p>
        </div>
      </div>
    </div>
  </div>
);
