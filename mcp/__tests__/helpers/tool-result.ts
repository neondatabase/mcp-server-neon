import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { assert } from '../../../lib/assert';

export function textContent(result: CallToolResult, index = 0): string {
  const block = result.content[index];
  assert(block?.type === 'text', `content[${index}] is not a text block`);
  return block.text;
}

export function jsonContent(result: CallToolResult, index = 0): unknown {
  return JSON.parse(textContent(result, index));
}
