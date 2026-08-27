import { describe, expect, it } from 'vitest';
import {
  formatInspectQueryError,
  selectInspectTargets,
} from '../inspect/targets';

describe('selectInspectTargets', () => {
  it('uses databaseName and keeps the single-database schema', () => {
    expect(
      selectInspectTargets({
        databaseName: 'other_db',
        branchDatabases: ['neondb', 'other_db'],
        scope: 'database',
      }),
    ).toEqual({
      databases: ['other_db'],
      includeDatabaseColumn: false,
    });
  });

  it('omitting the name on a database-scoped check covers every database and names them', () => {
    expect(
      selectInspectTargets({
        branchDatabases: ['other_db', 'neondb'],
        scope: 'database',
      }),
    ).toEqual({
      databases: ['neondb', 'other_db'],
      includeDatabaseColumn: true,
    });
  });

  it('still names the database when the branch only has one', () => {
    expect(
      selectInspectTargets({
        branchDatabases: ['neondb'],
        scope: 'database',
      }),
    ).toEqual({
      databases: ['neondb'],
      includeDatabaseColumn: true,
    });
  });

  it('omitting the name on a compute-scoped check picks the first listed database', () => {
    expect(
      selectInspectTargets({
        branchDatabases: ['other_db', 'neondb'],
        scope: 'compute',
      }),
    ).toEqual({
      databases: ['other_db'],
      includeDatabaseColumn: false,
    });
  });

  it('rejects an empty databaseName', () => {
    expect(() =>
      selectInspectTargets({
        databaseName: '',
        branchDatabases: ['neondb', 'other_db'],
        scope: 'database',
      }),
    ).toThrow(
      'database_name cannot be empty. Omit it to cover every database.',
    );
  });

  it('throws when the branch has no databases', () => {
    expect(() =>
      selectInspectTargets({
        branchDatabases: [],
        scope: 'database',
      }),
    ).toThrow('No databases found for the branch');
  });
});

describe('formatInspectQueryError', () => {
  it('leaves named-database errors unchanged', () => {
    expect(
      formatInspectQueryError({
        reason: 'missing neon',
        database: 'neondb',
        databaseName: 'neondb',
        offerDatabaseNameHint: true,
        scope: 'database',
      }),
    ).toBeUndefined();
  });

  it('names the database the tool chose when databaseName is omitted', () => {
    expect(
      formatInspectQueryError({
        reason: 'missing neon',
        database: 'other_db',
        offerDatabaseNameHint: false,
        scope: 'compute',
      }),
    ).toBe('missing neon (database other_db)');
  });

  it('points at databaseName when a database-scoped fan-out fails', () => {
    expect(
      formatInspectQueryError({
        reason: 'missing neon',
        database: 'analytics',
        offerDatabaseNameHint: true,
        scope: 'database',
      }),
    ).toBe(
      'missing neon (database analytics). Pass database_name to inspect one database.',
    );
  });

  it('tells an extension failure to try a database that already has it', () => {
    expect(
      formatInspectQueryError({
        reason:
          'This query needs the "neon" extension, which is not installed.',
        database: 'analytics',
        offerDatabaseNameHint: true,
        scope: 'compute',
        requiresExtension: 'neon',
      }),
    ).toBe(
      'This query needs the "neon" extension, which is not installed. (database analytics). Pass database_name to try a database that already has the "neon" extension.',
    );
  });

  it('does not repeat a database the reason already named', () => {
    expect(
      formatInspectQueryError({
        reason:
          'The "outliers" check needs the "pg_stat_statements" extension, which is not installed on database "neondb".',
        database: 'neondb',
        offerDatabaseNameHint: true,
        scope: 'database',
        requiresExtension: 'pg_stat_statements',
      }),
    ).toBe(
      'The "outliers" check needs the "pg_stat_statements" extension, which is not installed on database "neondb". Pass database_name to try a database that already has the "pg_stat_statements" extension.',
    );
  });

  it('does not attach the extension hint to a connection error', () => {
    expect(
      formatInspectQueryError({
        reason: 'Could not connect to Postgres',
        database: 'analytics',
        offerDatabaseNameHint: true,
        scope: 'compute',
        requiresExtension: 'neon',
      }),
    ).toBe(
      'Could not connect to Postgres (database analytics). Pass database_name to connect through a different database.',
    );
  });

  it('tells compute-wide omit to connect through a different database', () => {
    expect(
      formatInspectQueryError({
        reason: 'missing neon',
        database: 'analytics',
        offerDatabaseNameHint: true,
        scope: 'compute',
      }),
    ).toBe(
      'missing neon (database analytics). Pass database_name to connect through a different database.',
    );
  });
});
