import type { Item, ItemMeta } from '../types';

/**
 * Total order over versions of the same item. Positive when `a` wins.
 *  1. higher updatedAt
 *  2. tombstone (deleted) beats live on equal updatedAt
 *  3. higher deviceId (string compare)
 *  4. canonical JSON compare — only reachable with corrupt/forged data, keeps merge deterministic
 */
export function compareVersions(a: ItemMeta, b: ItemMeta): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? 1 : -1;
  if (a.deleted !== b.deleted) return a.deleted ? 1 : -1;
  if (a.deviceId !== b.deviceId) return a.deviceId > b.deviceId ? 1 : -1;
  const ca = canonicalJson(a);
  const cb = canonicalJson(b);
  return ca === cb ? 0 : ca > cb ? 1 : -1;
}

/** Last-write-wins for a single item. Pure; returns one of its inputs. */
export function mergeItem<T extends ItemMeta>(local: T | undefined, incoming: T): T {
  if (!local) return incoming;
  if (local.id !== incoming.id) throw new Error(`mergeItem id mismatch: ${local.id} vs ${incoming.id}`);
  return compareVersions(incoming, local) > 0 ? incoming : local;
}

export interface MergeResult {
  /** Full merged set, keyed by id. */
  merged: Map<string, Item>;
  /** Items from `incoming` that won and must be written locally. */
  changed: Item[];
}

/**
 * Merge a batch into an existing set. Idempotent, commutative and associative
 * because each id resolves to the max under `compareVersions`.
 */
export function mergeSets(local: Iterable<Item>, incoming: Iterable<Item>): MergeResult {
  const merged = new Map<string, Item>();
  for (const item of local) merged.set(item.id, mergeItem(merged.get(item.id), item));
  const changed = new Map<string, Item>();
  for (const item of incoming) {
    const current = merged.get(item.id);
    const winner = mergeItem(current, item);
    if (winner !== current) {
      merged.set(item.id, winner);
      changed.set(item.id, winner);
    }
  }
  return { merged, changed: [...changed.values()] };
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
