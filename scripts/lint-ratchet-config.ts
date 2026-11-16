// The overrides and ignore patterns .oxlintrc.json may have. Changing either
// list is a reviewed change to what the ratchet covers.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const TEST_FILES = ['**/*.test.ts', 'e2e/**/*.ts'];
const TOOLING_SCRIPTS = ['scripts/**'];
const REVIEWED_OVERRIDES = [TEST_FILES, TOOLING_SCRIPTS];

// Generated output, installed agent assets, and the vendored plugin.
const REVIEWED_IGNORES = [
  '.next/**',
  'node_modules/**',
  'next-env.d.ts',
  'test-results/**',
  'playwright-report/**',
  '.agents/**',
  '.claude/**',
  '.cursor/**',
  'tools/oxlint/anti-slop/**',
];

const OxlintConfig = z.object({
  ignorePatterns: z.array(z.string()).default([]),
  overrides: z.array(z.object({ files: z.array(z.string()) })).default([]),
});

const RuleSetting = z.union([
  z.string(),
  z.number(),
  z.tuple([z.union([z.string(), z.number()])]).rest(z.json()),
]);

const PluginRules = z.object({
  jsPlugins: z.array(z.object({ name: z.string() })).default([]),
  rules: z.record(z.string(), RuleSetting).default({}),
});

const parseConfig = (source: string) =>
  z.json().parse(JSON.parse(source.replaceAll(/^\s*\/\/.*$/gmu, '')));

const severity = (setting: z.infer<typeof RuleSetting>) =>
  Array.isArray(setting) ? setting[0] : setting;

/**
 * The JS-plugin rules a config turns on, as the `plugin(rule)` codes Oxlint
 * reports. Rules from built-in plugins are left out: categories enable those,
 * so a missing key does not mean a rule is new.
 */
const enabledPluginRules = (source: string): Set<string> => {
  const { jsPlugins, rules } = PluginRules.parse(parseConfig(source));
  const plugins = new Set(jsPlugins.map(({ name }) => name));

  return new Set(
    Object.entries(rules)
      .filter(([key, setting]) => {
        const plugin = key.slice(0, key.indexOf('/'));
        const level = severity(setting);

        return plugins.has(plugin) && level !== 'off' && level !== 0;
      })
      .map(([key]) => {
        const slash = key.indexOf('/');

        return `${key.slice(0, slash)}(${key.slice(slash + 1)})`;
      }),
  );
};

/** JS-plugin rules `current` enables and `main` does not; none without a main config. */
export const newlyEnabledPluginRules = (
  current: string,
  main: string | undefined,
): Set<string> => {
  if (main === undefined) {
    return new Set();
  }

  const onMain = enabledPluginRules(main);

  return new Set(
    [...enabledPluginRules(current)].filter((rule) => !onMain.has(rule)),
  );
};

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((item, i) => item === b[i]);

export const unreviewedConfig = async (root: string): Promise<string[]> => {
  const source = await readFile(path.join(root, '.oxlintrc.json'), 'utf8');

  const config = OxlintConfig.parse(parseConfig(source));

  const overrides = config.overrides
    .filter((o) => !REVIEWED_OVERRIDES.some((r) => sameList(o.files, r)))
    .map(
      (o) =>
        `.oxlintrc.json: the override for ${o.files.join(', ')} is not a reviewed group (tests, tooling scripts). Lower the baseline instead of turning a rule off.`,
    );

  const ignores = sameList(config.ignorePatterns, REVIEWED_IGNORES)
    ? []
    : [
        `.oxlintrc.json: ignorePatterns differ from REVIEWED_IGNORES in scripts/lint-ratchet-config.ts. Lower the baseline instead of ignoring source.`,
      ];

  return [...overrides, ...ignores];
};
