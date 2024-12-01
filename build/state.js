const migrationsState = new Map();
export function getMigrationFromMemory(migrationId) {
    return migrationsState.get(migrationId);
}
export function persistMigrationToMemory(migrationId, migrationDetails) {
    migrationsState.set(migrationId, migrationDetails);
}
