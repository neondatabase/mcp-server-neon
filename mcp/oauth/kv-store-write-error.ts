/** A store table's write or delete failed; Keyv only reports it as `false`. */
export class KvStoreWriteError extends Error {
  constructor(operation: string, table: string, options: { cause: unknown }) {
    super(`OAuth store ${operation} on ${table} failed`, options);
    this.name = 'KvStoreWriteError';
  }
}
