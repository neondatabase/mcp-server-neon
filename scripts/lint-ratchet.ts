// Holds Oxlint violations, per file and rule, to scripts/lint-baseline.json.
// Fails when a count rises, when a file or rule appears that the baseline
// lacks, when the baseline grew against origin/main, when a disable comment
// appears or changes, when Oxlint reports a parse error, or when
// .oxlintrc.json gains an override or ignore pattern outside the reviewed ones.
// A JS-plugin rule that origin/main does not enable may enter the baseline in
// the PR that enables it (--adopt); after that it only shrinks.
//
//   pnpm lint          check
//   pnpm lint:shrink   lower the baseline to what is found (never raises it)
//   pnpm lint:adopt    baseline the rules this branch newly enables
//   pnpm lint:report   totals, worst rules, worst files
//   tsx scripts/lint-ratchet.ts --init   write the first baseline
//
// Adapted from mattpocock/sandcastle scripts/lint-ratchet.ts under the MIT
// License; see scripts/LICENSE.sandcastle.

import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { onMain, runCommand } from './lint-ratchet-git';
import type { Counts, Violation } from './lint-ratchet-core';
import {
  adopt,
  countViolations,
  disableComments,
  grown,
  report,
  shrink,
  withoutRules,
} from './lint-ratchet-core';
import {
  newlyEnabledPluginRules,
  unreviewedConfig,
} from './lint-ratchet-config';

const ROOT = path.resolve(import.meta.dirname, '..');
const BASELINE = 'scripts/lint-baseline.json';

const VENDORED = ['tools/oxlint/anti-slop/', '.agents/'];

// Oxlint loads the vendored anti-slop plugins from .ts files, which Node 22
// before 22.18 only runs with type stripping enabled.
const OXLINT_ENV = {
  ...process.env,
  NODE_OPTIONS: `--experimental-strip-types ${process.env.NODE_OPTIONS ?? ''}`,
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
  const out = runCommand(
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
  const deleted = new Set(lines(runCommand('git', ['ls-files', '--deleted'])));

  const files = lines(
    runCommand('git', [
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
    ]),
  ).filter(
    (file) =>
      !deleted.has(file) &&
      SCANNED_EXTENSIONS.has(path.extname(file)) &&
      !VENDORED.some((prefix) => file.startsWith(prefix)),
  );

  // The rule names the whole comment, so widening an allowed directive (a
  // file-wide disable, more rules) counts as a new one.
  const perFile = await Promise.all(
    files.map(async (file) => {
      const source = await readFile(path.join(ROOT, file), 'utf8');

      return disableComments(file, source).map((comment) => ({
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

const newlyEnabledRules = async (): Promise<Set<string>> =>
  newlyEnabledPluginRules(
    await readFile(path.join(ROOT, '.oxlintrc.json'), 'utf8'),
    onMain('.oxlintrc.json'),
  );

const section = (title: string, entries: readonly string[]): string =>
  entries.length === 0
    ? ''
    : `\n${title}\n${entries.map((l) => `  ${l}`).join('\n')}\n`;

type Mode = 'check' | 'shrink' | 'adopt';

const updateBaseline = async (
  mode: Mode,
  found: Counts,
  adopted: ReadonlySet<string>,
): Promise<void> => {
  if (mode === 'shrink') {
    await writeBaseline(shrink(found, await readBaseline()));
  }

  if (mode === 'adopt') {
    await writeBaseline(adopt(found, await readBaseline(), adopted));
  }
};

const verify = async (mode: Mode): Promise<void> => {
  const found = await collect();
  const adopted = await newlyEnabledRules();

  await updateBaseline(mode, found, adopted);

  const baseline = await readBaseline();
  const mainBaseline = onMain(BASELINE);

  // Growth against origin/main, apart from the rules this branch adopts.
  const growth =
    mainBaseline === undefined
      ? undefined
      : grown(
          withoutRules(baseline, adopted),
          Baseline.parse(JSON.parse(mainBaseline)),
        );

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
    await verify('shrink');
    break;
  }

  case '--adopt': {
    await verify('adopt');
    break;
  }

  case undefined: {
    await verify('check');
    break;
  }

  default: {
    throw new Error(
      `Unknown mode ${process.argv[2]}; use --init, --report, --shrink, or --adopt.`,
    );
  }
}
