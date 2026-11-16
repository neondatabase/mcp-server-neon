import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { fromJsonSchema } from '@modelcontextprotocol/server';
import type { ToolId } from './operations';
import type { NeonTool } from './tool-definition';

const contracts = new Map<ToolId, ReturnType<typeof fromJsonSchema>>();

/** The tool's `outputSchema`, compiled once with the SDK's validator. */
export const outputContract = (tool: NeonTool) => {
  const cached = contracts.get(tool.id);

  if (cached !== undefined) {
    return cached;
  }

  const contract = fromJsonSchema(tool.outputSchema);

  contracts.set(tool.id, contract);

  return contract;
};

/**
 * Throws when a successful result breaks the tool's `outputSchema`. The MCP SDK
 * runs the same check after the handler returns and would turn the result into
 * an error the tool-call span and analytics had already counted as a success.
 */
export const assertOutputContract = (
  tool: NeonTool,
  result: CallToolResult,
): void => {
  if (result.isError === true) {
    return;
  }

  const checked = outputContract(tool)['~standard'].validate(
    result.structuredContent,
  );

  if (checked instanceof Promise) {
    throw new TypeError(`${tool.name} output validation is asynchronous`);
  }

  if (checked.issues !== undefined) {
    throw new Error(
      `${tool.name} result breaks its output schema: ${checked.issues.map((issue) => issue.message).join('; ')}`,
    );
  }
};
