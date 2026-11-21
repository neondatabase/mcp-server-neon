import { agentSentryTags } from '../sentry/utils';
import { NEON_TOOLS } from '../tools/definitions';
import { isDocsOnlyTool } from '../tools/grant-filter';
import { NO_LIST_CHANGED } from '../tools/registration';
import { identifyClient } from '../utils/client-application';
import { logger } from '../utils/logger';
import { docsToolCall } from './docs-tool-call';
import { mcpHandler } from './mcp-request';
import type { McpRequestHandler } from './mcp-request';
import { registerTools } from './register-tools';
import { createSdkErrorReporter } from './sdk-errors';

// The docs-only handler bypasses OAuth entirely. It only registers the
// `docs` category tools plus send_feedback and list_incidents. None of them
// touch the Neon API: they call neon.com, the feedback service, or
// neonstatus.com, and run with no credential. We deliberately avoid going
// through `getAvailableTools` / `grant-filter` here so the "always available"
// search/fetch tools (which require Neon API auth) are not surfaced
// anonymously.
const DOCS_ONLY_TOOLS = NEON_TOOLS.filter((tool) => isDocsOnlyTool(tool));

/** The MCP server for one anonymous `?category=docs` request. */
export const createDocsOnlyMcpHandler = (
  userAgent: string | undefined,
): McpRequestHandler => {
  const agent = {
    clientName: 'anonymous-docs',
    clientApplication: identifyClient(userAgent).clientApplication,
  };

  const sdkErrors = createSdkErrorReporter(() => agentSentryTags(agent));

  return mcpHandler({
    initialize: (server) => {
      registerTools(server, DOCS_ONLY_TOOLS, docsToolCall(agent, userAgent));
    },
    capabilities: { tools: NO_LIST_CHANGED },
    onEvent: (event) => {
      if (event.type === 'ERROR') {
        sdkErrors.onError(event);

        return;
      }

      if (event.type === 'REQUEST_COMPLETED' && event.status === 'error') {
        logger.warn('MCP docs-only request failed', {
          method: event.method,
          duration: event.duration,
        });
      }
    },
    sdkErrors,
  });
};
