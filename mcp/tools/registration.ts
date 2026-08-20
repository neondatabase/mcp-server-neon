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

import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { Api } from '../neon-client';
import type { GrantContext } from '../utils/grant-context';
import { NEON_HANDLERS } from './tools';
import { injectProjectId } from './grant-filter';
import { NEON_TOOLS } from './definitions';
import type { NeonTool } from './tool-definition';
import type { ToolHandlerExtraParams } from './types';

/**
 * What `registerTool` is given. Flat, because that is what a client sends:
 * `{"name":"run_sql","arguments":{"sql":"…","projectId":"…"}}`.
 */
export function toolRegistration(tool: NeonTool): {
  description: string;
  inputSchema: NeonTool['inputSchema'];
  annotations: ToolAnnotations;
} {
  return {
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
  };
}

function toolByName(toolName: string): NeonTool | undefined {
  return NEON_TOOLS.find((tool) => tool.name === toolName);
}

/**
 * The project id is injected before the handler sees the arguments because a
 * project-scoped grant has it stripped out of the published schema, so the
 * client cannot send it and this is its only source.
 */
export async function invokeTool(
  toolName: string,
  args: unknown,
  grant: GrantContext,
  neonClient: Api<unknown>,
  extra: ToolHandlerExtraParams,
) {
  const handler = NEON_HANDLERS[toolName];
  if (!handler) {
    throw new Error(`Handler for tool ${toolName} not found`);
  }
  const tool = toolByName(toolName);
  const effectiveArgs = injectProjectId(
    (args ?? {}) as Record<string, unknown>,
    grant,
    tool,
  );

  return handler({ params: effectiveArgs }, neonClient, extra);
}
