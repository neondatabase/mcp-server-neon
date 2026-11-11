// Adapted from mattpocock/sandcastle scripts/lint-ratchet-core.ts under the
// MIT License; see scripts/LICENSE.sandcastle.

export type Violation = {
  readonly file: string;
  readonly rule: string;
};

/** file -> rule -> number of violations. */
export type Counts = Record<string, Record<string, number>>;

const sortKeys = <T>(record: Readonly<Record<string, T>>): Record<string, T> =>
  Object.fromEntries(
    Object.entries(record).toSorted(([a], [b]) => a.localeCompare(b)),
  );

export const countViolations = (violations: readonly Violation[]): Counts => {
  const counts: Counts = {};

  for (const { file, rule } of violations) {
    const rules = counts[file] ?? {};
    rules[rule] = (rules[rule] ?? 0) + 1;
    counts[file] = rules;
  }

  return Object.fromEntries(
    Object.entries(sortKeys(counts)).map(([file, rules]) => [
      file,
      sortKeys(rules),
    ]),
  );
};

const pairs = (counts: Counts): (readonly [string, string, number])[] =>
  Object.entries(counts).flatMap(([file, rules]) =>
    Object.entries(rules).map(([rule, n]) => [file, rule, n] as const),
  );

const countOf = (counts: Counts, file: string, rule: string): number =>
  counts[file]?.[rule] ?? 0;

/** Counts in `found` above `baseline`, including files and rules it lacks. */
export const grown = (found: Counts, baseline: Counts): string[] =>
  pairs(found)
    .filter(([file, rule, n]) => n > countOf(baseline, file, rule))
    .map(
      ([file, rule, n]) =>
        `${file}: ${rule} ${String(countOf(baseline, file, rule))} -> ${String(n)}`,
    );

/**
 * The baseline lowered to what was found. Never raises a count and never
 * adds a file or rule: the result is the pairwise minimum, zeros dropped.
 */
export const shrink = (found: Counts, baseline: Counts): Counts =>
  countViolations(
    pairs(baseline).flatMap(([file, rule, n]) =>
      Array.from({ length: Math.min(n, countOf(found, file, rule)) }, () => ({
        file,
        rule,
      })),
    ),
  );

const top = (totals: Record<string, number>, limit: number): string[] =>
  Object.entries(totals)
    .toSorted(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([key, n]) => `  ${String(n).padStart(6)}  ${key}`);

export const report = (counts: Counts, limit: number): string => {
  const byRule: Record<string, number> = {};
  const byFile: Record<string, number> = {};

  for (const [file, rule, n] of pairs(counts)) {
    byRule[rule] = (byRule[rule] ?? 0) + n;
    byFile[file] = (byFile[file] ?? 0) + n;
  }

  const total = Object.values(byFile).reduce((sum, n) => sum + n, 0);

  return [
    `${String(total)} violations, ${String(Object.keys(byFile).length)} files, ${String(Object.keys(byRule).length)} rules`,
    'Top rules:',
    ...top(byRule, limit),
    'Top files:',
    ...top(byFile, limit),
  ].join('\n');
};
