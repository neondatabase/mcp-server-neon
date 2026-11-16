import type { CallToolResult } from '@modelcontextprotocol/server';

/**
 * Access-control warnings go in the text and in `structuredContent`: some
 * clients show the model only the text, others only `structuredContent`.
 */
export const appendAccessWarnings = (
  result: CallToolResult,
  warnings: readonly string[],
): void => {
  if (warnings.length === 0) {
    return;
  }

  result.content.push(
    ...warnings.map((text) => ({ type: 'text' as const, text })),
  );

  if (result.structuredContent !== undefined) {
    result.structuredContent = { ...result.structuredContent, warnings };
  }
};
