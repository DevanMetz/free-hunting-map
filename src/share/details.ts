import type { Item } from '../types';

/** Optional interchange fields. Hidden state belongs to sync, not shared files. */
export function shareDetails(item: Item): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ['categoryId', 'categoryName', 'color', 'iconOverride'] as const) if (item[key] !== undefined) out[key] = item[key];
  if (item.kind === 'waypoint') for (const key of ['fov', 'camera', 'setAt', 'checkedAt'] as const) if (item[key] !== undefined) out[key] = item[key];
  return out;
}
export function parseDetails(text: string): Record<string, unknown> {
  try { const value: unknown = JSON.parse(text); return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; } catch { return {}; }
}
