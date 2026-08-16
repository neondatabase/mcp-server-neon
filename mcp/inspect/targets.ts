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
        'databaseName cannot be empty. Omit it to cover every database.',
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
      ? `. Pass databaseName to try a database that already has the "${input.requiresExtension}" extension.`
      : input.scope === 'compute'
        ? '. Pass databaseName to connect through a different database.'
        : '. Pass databaseName to inspect one database.';
  return `${input.reason} (database ${input.database})${hint}`;
};
