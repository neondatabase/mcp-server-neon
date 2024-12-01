import { Branch } from '@neondatabase/api-client';

type MigrationId = string;
type MigrationDetails = {
  migrationSql: string;
  appliedBranch: Branch;
  databaseName: string;
};

const migrationsState = new Map<MigrationId, MigrationDetails>();

export function getMigrationFromMemory(migrationId: string) {
  return migrationsState.get(migrationId);
}

export function persistMigrationToMemory(
  migrationId: string,
  migrationDetails: MigrationDetails,
) {
  migrationsState.set(migrationId, migrationDetails);
}
