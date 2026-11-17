import { describe, expect, it } from 'vitest';
import { NEON_TOOLS } from '../tools/definitions';
import type { GeneratedToolId } from '../tools/operations';
import { isGeneratedToolId } from '../tools/operations';
import { sanitizedFields } from '../tools/sanitize';
import type { NeonTool } from '../tools/tool-definition';

describe('output schemas', () => {
  it('lists no field the server strips from a result', () => {
    const generated = NEON_TOOLS.filter(
      (tool): tool is NeonTool & { id: GeneratedToolId } =>
        isGeneratedToolId(tool.id),
    );

    const listed = generated.flatMap((tool) =>
      sanitizedFields(tool.id)
        .filter((field) =>
          JSON.stringify(tool.outputSchema).includes(`"${field}":`),
        )
        .map((field) => `${tool.name}.${field}`),
    );

    expect(listed).toStrictEqual([]);
  });

  it('publishes search and fetch results at the root of structuredContent', () => {
    const roots = Object.fromEntries(
      NEON_TOOLS.filter((tool) => ['search', 'fetch'].includes(tool.name)).map(
        (tool) => [tool.name, tool.outputSchema.required],
      ),
    );

    expect(roots).toStrictEqual({
      search: ['results'],
      fetch: ['id', 'title', 'text', 'url', 'metadata'],
    });
  });
});
