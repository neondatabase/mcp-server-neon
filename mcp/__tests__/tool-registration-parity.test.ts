import { describe, expect, it } from 'vitest';
import { NEON_TOOLS } from '../tools/definitions';
import { toListedInputSchema } from '../tools/listed-schema';
import { toolRegistration } from '../tools/registration';
import type { ToolInputSchema } from '../tools/tool-definition';

/**
 * The published JSON Schema, converted the same way the server converts it —
 * some tool schemas are refined objects rather than plain ones, so reading
 * `.shape` off them does not work.
 */
function publishedProperties(inputSchema: ToolInputSchema): string[] {
  const jsonSchema = toListedInputSchema(inputSchema);
  const properties = jsonSchema.properties;
  if (
    typeof properties !== 'object' ||
    properties === null ||
    Array.isArray(properties)
  ) {
    return [];
  }
  return Object.keys(properties);
}

/**
 * These lock down the wire contract that the two servers used to disagree on.
 *
 * The deployed route registered a flat schema while `createMcpServer` nested it
 * under `params`, so every test drove an envelope no real client sends, and
 * `injectProjectId` wrote a sibling key that no handler reads — project scoping
 * was silently a no-op on the tested path. Both now go through
 * `mcp/tools/registration.ts`; this is what stops them drifting apart again.
 */
describe('tool registration wire contract', () => {
  it.each(NEON_TOOLS.map((tool) => tool.name))(
    '%s publishes its own fields at the top level, not under `params`',
    (name) => {
      const tool = NEON_TOOLS.find((candidate) => candidate.name === name);
      if (!tool) throw new Error(`Unknown tool ${name}`);

      const properties = publishedProperties(
        toolRegistration(tool).inputSchema,
      );

      expect(properties).not.toContain('params');
    },
  );

  it('carries the description and annotations through unchanged', () => {
    for (const tool of NEON_TOOLS) {
      const registration = toolRegistration(tool);
      expect(registration.description).toBe(tool.description);
      expect(registration.annotations).toBe(tool.annotations);
      expect(registration.inputSchema).toBe(tool.inputSchema);
    }
  });
});
