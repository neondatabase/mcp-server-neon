import { agentSentryTags } from '../sentry/utils';
import type { AuthenticatedAuthInfo } from '../transport/oauth-token';
import {
  formatAccessControlInstructions,
  getAvailableTools,
} from '../tools/grant-filter';
import { NO_LIST_CHANGED } from '../tools/registration';
import {
  authenticatedEvents,
  onInitialized,
  onServerError,
} from './authenticated-lifecycle';
import { newClientIdentity, toolListContext } from './authenticated-session';
import type { ServerState } from './authenticated-session';
import { authenticatedToolCall } from './authenticated-tool-call';
import { mcpHandler } from './mcp-request';
import type { McpRequestHandler } from './mcp-request';
import { registerTools } from './register-tools';
import { createSdkErrorReporter } from './sdk-errors';

/** The MCP server for one request from an authenticated caller. */
export const createAuthenticatedMcpHandler = (
  authInfo: AuthenticatedAuthInfo,
): McpRequestHandler => {
  const { grant, readOnly } = toolListContext(authInfo);
  const client = newClientIdentity();

  const sdkErrors = createSdkErrorReporter(() =>
    agentSentryTags(client.identified),
  );

  return mcpHandler({
    initialize: (server) => {
      const state: ServerState = {
        trackedServerInit: false,
        lastKnownContext: undefined,
      };

      // The SDK's Protocol takes its lifecycle hooks as properties only.
      Object.assign(server.server, {
        oninitialized: onInitialized(client),
        onerror: onServerError(client, state, sdkErrors),
      });
      registerTools(
        server,
        getAvailableTools(grant, readOnly),
        authenticatedToolCall({ authInfo, client, state }),
      );
    },
    capabilities: { tools: NO_LIST_CHANGED, resources: NO_LIST_CHANGED },
    instructions: formatAccessControlInstructions(grant, readOnly),
    onEvent: authenticatedEvents(sdkErrors),
    sdkErrors,
  });
};
