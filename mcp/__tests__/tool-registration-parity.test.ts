import { describe, expect, it } from 'vitest';
import type { StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import { NEON_TOOLS } from '../tools/definitions';
import { toolRegistration } from '../tools/registration';

/**
 * The draft-7 JSON Schema published by the MCP SDK.
 */
function publishedSchema(inputSchema: StandardSchemaWithJSON) {
  return inputSchema['~standard'].jsonSchema.input({
    target: 'draft-07',
  });
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

      const schema = publishedSchema(toolRegistration(tool).inputSchema);
      const properties =
        schema.properties && typeof schema.properties === 'object'
          ? Object.keys(schema.properties)
          : [];

      expect(properties).not.toContain('params');
    },
  );

  it('rejects unspecified properties in every published tool schema', () => {
    for (const tool of NEON_TOOLS) {
      const schema = publishedSchema(toolRegistration(tool).inputSchema);
      expect(schema.additionalProperties).toBe(false);
    }
  });

  it.each([
    ['configure_neon_auth', 'operation'],
    ['provision_neon_data_api', 'authProvider'],
  ])('publishes the refined %s input fields', (name, expectedProperty) => {
    const tool = NEON_TOOLS.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`Unknown tool ${name}`);

    const schema = publishedSchema(toolRegistration(tool).inputSchema);
    expect(schema.properties).toHaveProperty(expectedProperty);
  });

  it('keeps stripping unspecified runtime arguments', async () => {
    const tool = NEON_TOOLS.find(
      (candidate) => candidate.name === 'list_projects',
    );
    if (!tool) throw new Error('Unknown tool list_projects');

    const result = await toolRegistration(tool).inputSchema[
      '~standard'
    ].validate({
      unspecified: true,
    });
    if ('issues' in result) {
      throw new Error('Expected unspecified arguments to be stripped');
    }
    expect(result.value).not.toHaveProperty('unspecified');
  });

  it('carries the description and annotations through unchanged', () => {
    for (const tool of NEON_TOOLS) {
      const registration = toolRegistration(tool);
      expect(registration.description).toBe(tool.description);
      expect(registration.annotations).toBe(tool.annotations);
      expect(registration.title).toBe(tool.annotations.title);
    }
  });
});
