import { Branch } from '@neondatabase/api-client';

type MigrationId = string;
export type MigrationDetails = {
  migrationSql: string;
  databaseName: string;
  appliedBranch: Branch;
  roleName?: string;
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
