import type { Item, LngLat } from '../types';
import { sanitizeItem } from '../sync/validate';

/**
 * Compact array encoding for QR payloads. Coordinates are integer micro-degrees,
 * track points delta-encoded. Lossless for stored (6-decimal) coordinates.
 *   waypoint: ['w', id, createdAt, updatedAt, deviceId, deleted, name, note, icon, lng, lat]
 *   track:    ['t', id, createdAt, updatedAt, deviceId, deleted, name, note, recorded, ...dLng, dLat pairs]
 */
export type CompactItem = (string | number)[];

const E6 = 1e6;

export function toCompact(item: Item): CompactItem {
  const head = [item.id, item.createdAt, item.updatedAt, item.deviceId, item.deleted ? 1 : 0, item.name, item.note];
  if (item.kind === 'waypoint') {
    return ['w', ...head, item.icon, Math.round(item.coord[0] * E6), Math.round(item.coord[1] * E6), ...(item.sourceUrl ? [item.sourceUrl] : [])];
  }
  const out: CompactItem = ['t', ...head, item.recorded ? 1 : 0];
  let pLng = 0;
  let pLat = 0;
  for (const [lng, lat] of item.coords) {
    const x = Math.round(lng * E6);
    const y = Math.round(lat * E6);
    out.push(x - pLng, y - pLat);
    pLng = x;
    pLat = y;
  }
  return out;
}

export function fromCompact(c: unknown): Item | null {
  if (!Array.isArray(c) || c.length < 8) return null;
  const [kind, id, createdAt, updatedAt, deviceId, deleted, name, note] = c;
  const meta = { id, createdAt, updatedAt, deviceId, deleted: deleted === 1, name, note };
  if (kind === 'w') {
    const [icon, x, y] = c.slice(8);
    if (typeof x !== 'number' || typeof y !== 'number') return null;
    return sanitizeItem({ ...meta, kind: 'waypoint', icon, coord: [x / E6, y / E6], sourceUrl: c[11] });
  }
  if (kind === 't') {
    const rest = c.slice(9);
    if (rest.length % 2 !== 0) return null;
    const coords: LngLat[] = [];
    let x = 0;
    let y = 0;
    for (let i = 0; i < rest.length; i += 2) {
      const dx = rest[i];
      const dy = rest[i + 1];
      if (typeof dx !== 'number' || typeof dy !== 'number') return null;
      x += dx;
      y += dy;
      coords.push([x / E6, y / E6]);
    }
    return sanitizeItem({ ...meta, kind: 'track', recorded: c[8] === 1, coords });
  }
  return null;
}
