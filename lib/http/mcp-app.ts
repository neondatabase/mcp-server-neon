import { Layer } from 'effect';
import { HttpRouter } from 'effect/http';
import { Analytics } from '../../mcp/analytics/analytics-service';
import { McpHandlers } from '../../mcp/server/mcp-handlers';
import { NeonAccounts } from '../../mcp/server/neon-accounts';
import { memoMap } from '../effect/runtime';
import { AppLayer } from './app';
import { McpRoutes } from './routes/mcp';

// The MCP transport's own web handler, so the other route files don't load
// mcp-handler and the MCP server factories. It shares the app's memo map.
export const mcpApp = HttpRouter.toWebHandler(
  Layer.mergeAll(
    McpRoutes,
    McpHandlers.layer,
    NeonAccounts.layer,
    Analytics.layer,
    AppLayer,
  ),
  { disableLogger: true, memoMap },
);
