import { describe, expect, it } from 'vitest';
import { appendAccessWarnings } from '../tools/access-warnings';

const WARNING = 'Only the "search" tool is available.';

describe('appendAccessWarnings', () => {
  it('adds each warning to the text and to structuredContent', () => {
    const result = {
      content: [{ type: 'text' as const, text: '{}' }],
      structuredContent: { data: { id: 'proj-1' } },
    };

    appendAccessWarnings(result, [WARNING]);

    expect(result).toStrictEqual({
      content: [
        { type: 'text', text: '{}' },
        { type: 'text', text: WARNING },
      ],
      structuredContent: { data: { id: 'proj-1' }, warnings: [WARNING] },
    });
  });

  it('leaves a result without warnings unchanged', () => {
    const result = {
      content: [{ type: 'text' as const, text: '{}' }],
      structuredContent: { data: null },
    };

    appendAccessWarnings(result, []);

    expect(result).toStrictEqual({
      content: [{ type: 'text', text: '{}' }],
      structuredContent: { data: null },
    });
  });
});
