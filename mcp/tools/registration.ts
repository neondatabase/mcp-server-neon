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
import type { ToolAnnotations } from '@modelcontextprotocol/server';
import type { Api } from '../neon-client';
import type { GrantContext } from '../utils/grant-context';
import { NEON_HANDLERS } from './tools';
import { injectProjectId } from './grant-filter';
import type { NEON_TOOLS } from './definitions';
import type { ToolHandlerExtended, ToolHandlerExtraParams } from './types';

type NeonTool = (typeof NEON_TOOLS)[number];

/**
 * What `registerTool` is given. Flat, because that is what a client sends:
 * `{"name":"run_sql","arguments":{"sql":"…","projectId":"…"}}`.
 */
export function toolRegistration(tool: NeonTool): {
  title?: string;
  description: string;
  inputSchema: NeonTool['inputSchema'];
  annotations: ToolAnnotations;
} {
  return {
    title: tool.annotations?.title,
    description: tool.description,
    // NOTE: This intentionally stays strongly typed (no cast). If this starts failing
    // after an SDK upgrade, treat it as a schema-type compatibility regression between
    // MCP SDK zod-compat types and our tool schema definitions.
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
  };
}

/**
 * Run a tool the way the wire delivers it.
 *
 * `projectId` is injected before the handler sees the arguments because a
 * project-scoped grant has it stripped out of the published schema, so the
 * client cannot send it and this is its only source.
 */
export async function invokeTool(
  toolName: NeonTool['name'],
  // The SDK validates against the tool's zod schema before it calls us, so this
  // is an object by the time it arrives. It is typed loosely only because the
  // callback signature is shared across every tool.
  args: unknown,
  grant: GrantContext,
  neonClient: Api<unknown>,
  extra: ToolHandlerExtraParams,
) {
  const handler = NEON_HANDLERS[toolName] as ToolHandlerExtended<
    typeof toolName
  >;
  if (!handler) {
    throw new Error(`Handler for tool ${toolName} not found`);
  }
  const effectiveArgs = injectProjectId(
    (args ?? {}) as Record<string, unknown>,
    grant,
  );

  // Handlers read `params`; the wire is flat. This is the only place that
  // translates between the two.
  return handler(
    { params: effectiveArgs } as Parameters<typeof handler>[0],
    neonClient,
    extra,
  );
}
