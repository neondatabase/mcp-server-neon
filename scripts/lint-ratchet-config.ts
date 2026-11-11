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

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((item, i) => item === b[i]);

export const unreviewedConfig = async (root: string): Promise<string[]> => {
  const source = await readFile(path.join(root, '.oxlintrc.json'), 'utf8');

  const config = OxlintConfig.parse(
    JSON.parse(source.replaceAll(/^\s*\/\/.*$/gmu, '')),
  );

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
