import { describe, expect, it } from 'vitest';
import { newlyEnabledPluginRules } from './lint-ratchet-config';

type Setting = string | number | readonly [string, { maxDepth: number }];

const config = (rules: Record<string, Setting>) =>
  JSON.stringify({
    jsPlugins: [{ name: 'anti-slop', specifier: './anti-slop/index.ts' }],
    rules,
  });

describe('newlyEnabledPluginRules', () => {
  it('lists the plugin rules a branch turns on that main does not', () => {
    const main = config({ 'anti-slop/old-rule': 'error' });

    const current = `// comments are allowed\n${config({
      'anti-slop/old-rule': 'error',
      'anti-slop/new-rule': ['error', { maxDepth: 2 }],
      'anti-slop/new-warning': 'warn',
      'anti-slop/new-off': 'off',
      'eslint/curly': 'error',
    })}`;

    expect(newlyEnabledPluginRules(current, main)).toStrictEqual(
      new Set(['anti-slop(new-rule)', 'anti-slop(new-warning)']),
    );
  });

  it('counts a rule main turns off as new', () => {
    const main = config({ 'anti-slop/rule': 'off' });
    const current = config({ 'anti-slop/rule': 2 });

    expect(newlyEnabledPluginRules(current, main)).toStrictEqual(
      new Set(['anti-slop(rule)']),
    );
  });

  it('adopts nothing without a config on main', () => {
    expect(
      newlyEnabledPluginRules(config({ 'anti-slop/rule': 'error' }), undefined),
    ).toStrictEqual(new Set());
  });
});
