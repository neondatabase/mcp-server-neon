export type InspectQueryScope = 'database' | 'compute';

type InspectTargetSelection = {
  databases: string[];
  includeDatabaseColumn: boolean;
};

type SelectInspectTargetsInput = {
  databaseName?: string;
  branchDatabases: readonly string[];
  scope: InspectQueryScope;
};

/**
 * Keep the database column on one-database branches so adding another database
 * does not change the output schema. Compute-wide views run once because every
 * database returns the same rows.
 */
export const selectInspectTargets = (
  input: SelectInspectTargetsInput,
): InspectTargetSelection => {
  if (input.databaseName !== undefined) {
    if (input.databaseName === '') {
      throw new Error(
        'database_name cannot be empty. Omit it to cover every database.',
      );
    }
    return {
      databases: [input.databaseName],
      includeDatabaseColumn: false,
    };
  }
  if (input.branchDatabases.length === 0) {
    throw new Error('No databases found for the branch');
  }
  if (input.scope === 'compute') {
    return {
      databases: [input.branchDatabases[0]],
      includeDatabaseColumn: false,
    };
  }
  const sorted = [...input.branchDatabases].sort((a, b) =>
    a.localeCompare(b, 'en'),
  );
  return { databases: sorted, includeDatabaseColumn: true };
};

type FormatInspectQueryErrorInput = {
  reason: string;
  database: string;
  databaseName?: string;
  offerDatabaseNameHint: boolean;
  scope: InspectQueryScope;
  requiresExtension?: string;
};

export const formatInspectQueryError = (
  input: FormatInspectQueryErrorInput,
): string | undefined => {
  if (input.databaseName !== undefined) {
    return undefined;
  }
  const missingExtension =
    input.requiresExtension !== undefined &&
    input.reason.includes(`"${input.requiresExtension}"`);
  const hint = !input.offerDatabaseNameHint
    ? ''
    : missingExtension
      ? `. Pass database_name to try a database that already has the "${input.requiresExtension}" extension.`
      : input.scope === 'compute'
        ? '. Pass database_name to connect through a different database.'
        : '. Pass database_name to inspect one database.';
  const alreadyNamesDatabase = input.reason.includes(
    `database "${input.database}"`,
  );
  const tagged = alreadyNamesDatabase
    ? input.reason
    : `${input.reason} (database ${input.database})`;
  const suffix =
    hint.startsWith('.') && tagged.endsWith('.') ? hint.slice(1) : hint;
  return `${tagged}${suffix}`;
};
