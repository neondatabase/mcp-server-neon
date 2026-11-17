/**
 * The single definition of how a tool is put on the wire and how wire arguments
 * reach its handler.
 *
 * Both servers — the deployed route in `app/api/[transport]/route.ts` and
 * `createMcpServer`, which the tests drive — must register through here. They
 * used to do it themselves and disagreed: the route registered a flat schema
 * while `createMcpServer` nested it under `params`, so every test sent an
 * envelope no real client sends, and `injectProjectId` wrote into the wrong
 * object on that path and silently did nothing.
 *
 * The two servers still differ in where their auth context comes from — the
 * route resolves it per call from `authInfo`, `createMcpServer` binds it once —
 * and in what they log. Those differences are theirs to keep. This module owns
 * only the contract a client sees.
 */

import type {
  CallToolResult,
  ToolAnnotations,
} from '@modelcontextprotocol/sdk/types.js';
import { Effect } from 'effect';
import type { Api } from '../neon-client';
import type { GrantContext } from '../utils/grant-context';
import { toolSecrets } from '../utils/grant-context';
import { NEON_HANDLERS, step } from './tools';
import { injectProjectId } from './grant-filter';
import { NEON_TOOLS } from './definitions';
import { outputContract } from './output-contract';
import type { NeonTool } from './tool-definition';
import type { ToolCallError, ToolHandlerExtraParams } from './types';

/**
 * `McpServer` advertises `listChanged: true` for tools and resources unless it
 * is explicitly `false`. Every request builds a server whose tools are fixed by
 * the grant and which registers no resources, so no server ever sends a
 * list-changed notification.
 */
export const NO_LIST_CHANGED = { listChanged: false };

export function toolRegistration(tool: NeonTool): {
  title?: string;
  description: string;
  inputSchema: NeonTool['inputSchema'];
  outputSchema: ReturnType<typeof outputContract>;
  annotations: ToolAnnotations;
} {
  return {
    title: tool.annotations?.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: outputContract(tool),
    annotations: tool.annotations,
  };
}

function toolByName(toolName: string): NeonTool | undefined {
  return NEON_TOOLS.find((tool) => tool.name === toolName);
}

/**
 * A pinned role and the secrets mode reach handlers from the grant, overriding
 * anything already on `extra`, so a tool argument can never replace them.
 */
export function invokeTool(
  toolName: string,
  args: unknown,
  grant: GrantContext,
  neonClient: Api<unknown>,
  extra: ToolHandlerExtraParams,
): Effect.Effect<CallToolResult, ToolCallError> {
  const handler = NEON_HANDLERS[toolName];
  const tool = toolByName(toolName);
  return step(() => {
    if (!handler) {
      throw new Error(`Handler for tool ${toolName} not found`);
    }
    return {
      handler,
      args: injectProjectId(
        (args ?? {}) as Record<string, unknown>,
        grant,
        tool,
      ),
    };
  }).pipe(
    Effect.flatMap(({ handler: run, args: effectiveArgs }) =>
      run({ params: effectiveArgs }, neonClient, {
        ...extra,
        pinnedRoleName: grant.roleName,
        secrets: toolSecrets(toolName, grant, extra.readOnly === true),
      }),
    ),
  );
}
