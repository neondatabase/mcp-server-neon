import { describe, expect, it } from 'vitest';
import { adopt, disableComments, withoutRules } from './lint-ratchet-core';

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

describe('adopt', () => {
  const baseline = {
    'a.ts': { 'eslint(curly)': 2, 'anti-slop(new-rule)': 9 },
    'b.ts': { 'anti-slop(new-rule)': 1 },
  };

  const found = {
    'a.ts': { 'eslint(curly)': 5, 'anti-slop(new-rule)': 3 },
    'c.ts': { 'anti-slop(new-rule)': 4 },
  };

  const adopted = new Set(['anti-slop(new-rule)']);

  it('sets adopted rules to what was found and keeps every other count', () => {
    expect(adopt(found, baseline, adopted)).toStrictEqual({
      'a.ts': { 'anti-slop(new-rule)': 3, 'eslint(curly)': 2 },
      'c.ts': { 'anti-slop(new-rule)': 4 },
    });
  });

  it('drops adopted rules for the growth check against main', () => {
    expect(withoutRules(baseline, adopted)).toStrictEqual({
      'a.ts': { 'eslint(curly)': 2 },
    });
  });
});
