import { WAYPOINT_ICONS, type Item, type LngLat, type WaypointIcon } from '../types';
import { roundCoord } from '../map/geo';

const MAX_TEXT = 2000;
const MAX_COORDS = 100_000;

/** Coerce untrusted data (imports, QR scans) into a valid Item, or null. */
export function sanitizeItem(raw: unknown): Item | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id.length < 8 || r.id.length > 64) return null;
  const updatedAt = num(r.updatedAt);
  const createdAt = num(r.createdAt) ?? updatedAt;
  if (updatedAt === null || createdAt === null) return null;
  const deviceId = typeof r.deviceId === 'string' && r.deviceId ? r.deviceId.slice(0, 64) : 'unknown';
  const meta = { id: r.id, createdAt, updatedAt, deviceId, deleted: r.deleted === true };
  const name = text(r.name);
  const note = text(r.note);

  if (r.kind === 'waypoint') {
    const coord = lngLat(r.coord);
    if (!coord) return null;
    return { ...meta, kind: 'waypoint', name, note, icon: icon(r.icon), coord };
  }
  if (r.kind === 'track') {
    if (!Array.isArray(r.coords) || r.coords.length > MAX_COORDS) return null;
    const coords: LngLat[] = [];
    for (const c of r.coords) {
      const p = lngLat(c);
      if (!p) return null;
      coords.push(p);
    }
    return { ...meta, kind: 'track', name, note, coords, recorded: r.recorded === true };
  }
  return null;
}

export function isWaypointIcon(v: unknown): v is WaypointIcon {
  return typeof v === 'string' && (WAYPOINT_ICONS as readonly string[]).includes(v);
}

function icon(v: unknown): WaypointIcon {
  return isWaypointIcon(v) ? v : 'pin';
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.slice(0, MAX_TEXT) : '';
}

export function lngLat(v: unknown): LngLat | null {
  if (!Array.isArray(v) || v.length < 2) return null;
  const [lng, lat] = v;
  if (typeof lng !== 'number' || typeof lat !== 'number') return null;
  if (!(lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90)) return null;
  return roundCoord([lng, lat]);
}
