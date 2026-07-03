const inflight = new Map<string, Promise<unknown>>();

/**
 * Deduplicates concurrent async calls by key. The first caller executes `fn`;
 * subsequent callers with the same key await the existing Promise.
 * The map entry is cleaned up once the Promise settles (success or error).
 */
export async function singleflight<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const existing = inflight.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const promise = fn();
  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
}
