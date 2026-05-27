import rawData from '../../data/active_pool.yaml';

export interface ActivePool {
  id: string;
  name: string;
  description?: string;
  enabled_tags: string[];
}

interface RawPoolFile {
  active: string;
  pools: ActivePool[];
}

const file = rawData as RawPoolFile;
export const POOLS: ActivePool[] = file.pools;
export const ACTIVE_POOL_ID: string = file.active;

export function getActivePool(): ActivePool {
  return POOLS.find((p) => p.id === ACTIVE_POOL_ID) ?? POOLS[0];
}

/**
 * Returns true if the given entry matches the active pool.
 * An entry "matches" when:
 *   - The pool has no enabled_tags (empty filter), OR
 *   - The entry's `system` field is in enabled_tags, OR
 *   - The entry's `source_book` field is in enabled_tags, OR
 *   - Any of the entry's tags array is in enabled_tags.
 */
export function isInActivePool(
  entry: { system?: string; source_book?: string; tags?: string[] },
  pool: ActivePool = getActivePool(),
): boolean {
  if (!pool.enabled_tags || pool.enabled_tags.length === 0) return true;
  const enabled = new Set(pool.enabled_tags);
  if (entry.system && enabled.has(entry.system)) return true;
  if (entry.source_book && enabled.has(entry.source_book)) return true;
  if (entry.tags) {
    for (const t of entry.tags) {
      if (enabled.has(t)) return true;
    }
  }
  return false;
}

/**
 * Filter a list of entries to those that match the active pool.
 * Returns the original list if the active pool is unrestricted.
 */
export function filterByActivePool<T extends { system?: string; source_book?: string; tags?: string[] }>(
  entries: T[],
  pool: ActivePool = getActivePool(),
): T[] {
  if (!pool.enabled_tags || pool.enabled_tags.length === 0) return entries;
  return entries.filter((e) => isInActivePool(e, pool));
}
