import { describe, expect, it } from 'vitest';
import { NEON_TOOLS } from '../tools/definitions';

describe('output schemas', () => {
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
