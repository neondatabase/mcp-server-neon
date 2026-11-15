import { describe, expect, it } from 'vitest';
import { disableComments } from './lint-ratchet-core';

describe('disableComments', () => {
  it('finds a directive in every comment form', () => {
    const source = [
      '// eslint-disable-next-line no-eval',
      '/* oxlint-disable */',
      '/*eslint-disable*/',
      '/** @ts-expect-error -- extra argument */',
      '/**',
      ' * @ts-ignore',
      ' */',
      '/*',
      ' oxlint-disable typescript/no-explicit-any */',
      '/*',
      '@ts-expect-error -- extra argument */',
      '// @effect-diagnostics floatingEffect:off',
      'export const x = 1; // @ts-nocheck',
    ].join('\n');

    expect(disableComments('fixture.ts', source)).toStrictEqual([
      '// eslint-disable-next-line no-eval',
      '/* oxlint-disable */',
      '/*eslint-disable*/',
      '/** @ts-expect-error -- extra argument */',
      '/**\n * @ts-ignore\n */',
      '/*\n oxlint-disable typescript/no-explicit-any */',
      '/*\n@ts-expect-error -- extra argument */',
      '// @effect-diagnostics floatingEffect:off',
      '// @ts-nocheck',
    ]);
  });

  it('finds a directive in a JSX expression comment', () => {
    const source =
      'export const A = () => <div>{/* eslint-disable-line */}</div>;';

    expect(disableComments('fixture.tsx', source)).toStrictEqual([
      '/* eslint-disable-line */',
    ]);
  });

  it('ignores strings, template literals, and passing mentions', () => {
    const source = [
      "const a = '// eslint-disable';",
      'const b = `/* @ts-ignore */`;',
      '// mentions @ts-ignore in passing',
    ].join('\n');

    expect(disableComments('fixture.ts', source)).toStrictEqual([]);
  });
});
