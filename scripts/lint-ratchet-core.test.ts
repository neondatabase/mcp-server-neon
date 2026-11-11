import { describe, expect, it } from 'vitest';
import { disableComments } from './lint-ratchet-core';

describe('disableComments', () => {
  it('finds every comment form TypeScript and Oxlint honor', () => {
    const source = [
      '// eslint-disable-next-line no-eval',
      '/* oxlint-disable */',
      '/*eslint-disable*/',
      '/** @ts-expect-error -- extra argument */',
      '/**',
      ' * @ts-ignore',
      ' */',
      '// @ts-nocheck',
      '// @effect-diagnostics floatingEffect:off',
    ].join('\n');

    expect(disableComments(source)).toStrictEqual([
      '// eslint-disable-next-line no-eval',
      '/* oxlint-disable */',
      '/*eslint-disable*/',
      '/** @ts-expect-error -- extra argument */',
      '* @ts-ignore',
      '// @ts-nocheck',
      '// @effect-diagnostics floatingEffect:off',
    ]);
  });

  it('ignores directive names that are not at the start of a comment', () => {
    const source = [
      "const name = 'eslint-disable';",
      '// mentions @ts-ignore in passing',
    ].join('\n');

    expect(disableComments(source)).toStrictEqual([]);
  });
});
