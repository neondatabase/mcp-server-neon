// Holds Oxlint violations, per file and rule, to scripts/lint-baseline.json.
// Fails when a count rises, when a file or rule appears that the baseline
// lacks, when the baseline grew against origin/main, when a disable comment
// appears or changes, when Oxlint reports a parse error, or when
// .oxlintrc.json gains an override or ignore pattern outside the reviewed ones.
//
//   pnpm lint          check
//   pnpm lint:shrink   lower the baseline to what is found (never raises it)
//   pnpm lint:report   totals, worst rules, worst files
//   tsx scripts/lint-ratchet.ts --init   write the first baseline
//
// Adapted from mattpocock/sandcastle scripts/lint-ratchet.ts under the MIT
// License; see scripts/LICENSE.sandcastle.

import { spawnSync } from 'node:child_process';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Counts, Violation } from './lint-ratchet-core';
import {
  countViolations,
  disableComments,
  grown,
  report,
  shrink,
} from './lint-ratchet-core';
import { unreviewedConfig } from './lint-ratchet-config';

const ROOT = path.resolve(import.meta.dirname, '..');
const BASELINE = 'scripts/lint-baseline.json';
const MAX_BUFFER = 256 * 1024 * 1024;

const VENDORED = ['tools/oxlint/anti-slop/', '.agents/'];

// Its fixtures are directive comments written as strings.
const DIRECTIVE_FIXTURES = 'scripts/lint-ratchet-core.test.ts';

// Oxlint loads the vendored anti-slop plugins from .ts files, which Node 22
// before 22.18 only runs with type stripping enabled.
const OXLINT_ENV = {
  ...process.env,
  NODE_OPTIONS: `--experimental-strip-types ${process.env.NODE_OPTIONS ?? ''}`,
};

/** Returns stdout whatever the exit code: Oxlint exits non-zero when it finds something. */
const run = (
  bin: string,
  args: readonly string[],
  env = process.env,
): string => {
  const result = spawnSync(bin, args, {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
  });

  if (result.error !== undefined) {
    throw result.error;
  }

  if (result.status !== 0 && result.stdout === '') {
    throw new Error(`${bin} ${args.join(' ')} failed: ${result.stderr}`);
  }

  return result.stdout;
};

const OxlintOutput = z.object({
  diagnostics: z.array(
    z.object({
      code: z.string().optional(),
      message: z.string(),
      filename: z.string(),
    }),
  ),
});

const UNUSED_DIRECTIVE = /^Unused \S+ directive/u;

const collectOxlint = (): Violation[] => {
  const out = run(
    path.join(ROOT, 'node_modules', '.bin', 'effect-tsgo'),
    // Only the root config and its reviewed ignorePatterns apply: nested
    // .oxlintrc.json files and .eslintignore would skip the checks below.
    [
      'oxlint',
      '--type-aware',
      '--config',
      '.oxlintrc.json',
      '--disable-nested-config',
      '--no-ignore',
      '--format',
      'json',
    ],
    OXLINT_ENV,
  );

  const { diagnostics } = OxlintOutput.parse(JSON.parse(out));

  return diagnostics.map((d) => {
    if (d.code !== undefined) {
      return { file: d.filename, rule: d.code };
    }

    // Oxlint omits `code` on unused disable directives and on parse errors;
    // a parse error must fail outright, whatever the baseline holds.
    if (!UNUSED_DIRECTIVE.test(d.message)) {
      throw new Error(`${d.filename}: ${d.message}`);
    }

    return { file: d.filename, rule: 'oxlint(unused-disable-directive)' };
  });
};

const SCANNED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
]);

const lines = (out: string): string[] =>
  out.split('\n').filter((line) => line !== '');

const collectDirectives = async (): Promise<Violation[]> => {
  const deleted = new Set(lines(run('git', ['ls-files', '--deleted'])));

  const files = lines(
    run('git', ['ls-files', '--cached', '--others', '--exclude-standard']),
  ).filter(
    (file) =>
      !deleted.has(file) &&
      file !== DIRECTIVE_FIXTURES &&
      SCANNED_EXTENSIONS.has(path.extname(file)) &&
      !VENDORED.some((prefix) => file.startsWith(prefix)),
  );

  // The rule names the whole comment, so widening an allowed directive (a
  // file-wide disable, more rules) counts as a new one.
  const perFile = await Promise.all(
    files.map(async (file) => {
      const source = await readFile(path.join(ROOT, file), 'utf8');

      return disableComments(source).map((comment) => ({
        file,
        rule: `ratchet/disable-comment ${comment}`,
      }));
    }),
  );

  return perFile.flat();
};

const collect = async (): Promise<Counts> =>
  countViolations([...collectOxlint(), ...(await collectDirectives())]);

const Baseline = z.record(z.string(), z.record(z.string(), z.number()));

const readBaseline = async (): Promise<Counts> =>
  Baseline.parse(JSON.parse(await readFile(path.join(ROOT, BASELINE), 'utf8')));

const writeBaseline = async (counts: Counts): Promise<void> => {
  await writeFile(
    path.join(ROOT, BASELINE),
    `${JSON.stringify(counts, null, 2)}\n`,
  );
};

/** Growth against origin/main; undefined when main has no baseline to compare with. */
const growthAgainstMain = (baseline: Counts): string[] | undefined => {
  const listed = run('git', [
    'ls-tree',
    '--name-only',
    'origin/main',
    BASELINE,
  ]);

  if (listed.trim() === '') {
    return undefined;
  }

  const main = Baseline.parse(
    JSON.parse(run('git', ['show', `origin/main:${BASELINE}`])),
  );

  return grown(baseline, main);
};

const section = (title: string, entries: readonly string[]): string =>
  entries.length === 0
    ? ''
    : `\n${title}\n${entries.map((l) => `  ${l}`).join('\n')}\n`;

const verify = async (shrinkFirst: boolean): Promise<void> => {
  const found = await collect();

  if (shrinkFirst) {
    await writeBaseline(shrink(found, await readBaseline()));
  }

  const baseline = await readBaseline();
  const growth = growthAgainstMain(baseline);

  if (growth === undefined) {
    process.stdout.write(
      `origin/main has no ${BASELINE}; skipped the growth check.\n`,
    );
  }

  const failures = [
    section(
      'New violations (file: rule baseline -> found). Fix them; never add a disable comment or raise the baseline:',
      grown(found, baseline),
    ),
    section(
      `${BASELINE} grew against origin/main. It only shrinks:`,
      growth ?? [],
    ),
    section('Config:', await unreviewedConfig(ROOT)),
  ].join('');

  if (failures !== '') {
    process.stderr.write(`lint ratchet failed:\n${failures}`);
    process.exitCode = 1;

    return;
  }

  const [summary] = report(found, 0).split('\n');
  process.stdout.write(`lint ratchet: ${summary}, none new.\n`);
};

const NotFound = z.object({ code: z.literal('ENOENT') });

const baselineExists = async (): Promise<boolean> => {
  try {
    await access(path.join(ROOT, BASELINE));

    return true;
  } catch (error) {
    if (NotFound.safeParse(error).success) {
      return false;
    }

    throw error;
  }
};

const init = async (): Promise<void> => {
  if (await baselineExists()) {
    throw new Error(
      `${BASELINE} exists and only shrinks; run --shrink instead.`,
    );
  }

  await writeBaseline(await collect());
};

const printReport = async (): Promise<void> => {
  process.stdout.write(`${report(await collect(), 15)}\n`);
};

switch (process.argv[2]) {
  case '--init': {
    await init();
    break;
  }

  case '--report': {
    await printReport();
    break;
  }

  case '--shrink': {
    await verify(true);
    break;
  }

  case undefined: {
    await verify(false);
    break;
  }

  default: {
    throw new Error(
      `Unknown mode ${process.argv[2]}; use --init, --report, or --shrink.`,
    );
  }
}
