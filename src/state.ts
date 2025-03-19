import { Branch } from '@neondatabase/api-client';

type MigrationId = string;
export type MigrationDetails = {
  migrationSql: string;
  databaseName: string;
  appliedBranch: Branch;
  roleName?: string;
};

type TuningId = string;
export type TuningDetails = {
  sql: string;
  databaseName: string;
  tuningBranch: Branch;
  roleName?: string;
  originalPlan?: any;
  suggestedChanges?: string[];
  improvedPlan?: any;
};

const migrationsState = new Map<MigrationId, MigrationDetails>();
const tuningState = new Map<TuningId, TuningDetails>();

export function getMigrationFromMemory(migrationId: string) {
  return migrationsState.get(migrationId);
}

export function persistMigrationToMemory(
  migrationId: string,
  migrationDetails: MigrationDetails,
) {
  migrationsState.set(migrationId, migrationDetails);
}

export function getTuningFromMemory(tuningId: string) {
  return tuningState.get(tuningId);
}

export function persistTuningToMemory(
  tuningId: string,
  tuningDetails: TuningDetails,
) {
  tuningState.set(tuningId, tuningDetails);
}

export function updateTuningInMemory(
  tuningId: string,
  updates: Partial<TuningDetails>,
) {
  const existing = tuningState.get(tuningId);
  if (existing) {
    tuningState.set(tuningId, { ...existing, ...updates });
  }
}
