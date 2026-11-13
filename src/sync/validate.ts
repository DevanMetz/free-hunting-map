import { WAYPOINT_ICONS, WIND_DIRS, type FieldOfView, type Item, type LngLat, type SightingSex, type WaypointIcon, type WindDir } from '../types';
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
  const organization = {
    ...(typeof r.categoryId === 'string' && r.categoryId.length >= 8 && r.categoryId.length <= 64 ? { categoryId: r.categoryId } : {}),
    ...(typeof r.categoryName === 'string' && r.categoryName.trim() ? { categoryName: r.categoryName.trim().slice(0, 120) } : {}),
    ...(typeof r.hidden === 'boolean' ? { hidden: r.hidden } : {}),
    ...(color(r.color) ? { color: color(r.color)! } : {}),
    ...(typeof r.iconOverride === 'boolean' ? { iconOverride: r.iconOverride } : {}),
  };
  const name = text(r.name);
  const note = text(r.note);

  if (r.kind === 'waypoint') {
    const coord = lngLat(r.coord);
    if (!coord) return null;
    const winds = windList(r.winds);
    return { ...meta, ...organization, ...cameraFields(r), ...sightingFields(r), kind: 'waypoint', name, note, icon: icon(r.icon), coord, ...(typeof r.sourceUrl === 'string' && /^https?:\/\//i.test(r.sourceUrl) ? { sourceUrl: r.sourceUrl.slice(0, 8192) } : {}), ...(winds ? { winds } : {}) };
  }
  if (r.kind === 'track') {
    if (!Array.isArray(r.coords) || r.coords.length > MAX_COORDS) return null;
    const coords: LngLat[] = [];
    for (const c of r.coords) {
      const p = lngLat(c);
      if (!p) return null;
      coords.push(p);
    }
    const segments = Array.isArray(r.segments) ? [...new Set(r.segments.filter((n): n is number => Number.isInteger(n) && n > 0 && n < coords.length))].sort((a, b) => a - b) : [];
    return { ...meta, ...organization, kind: 'track', name, note, coords, recorded: r.recorded === true, ...(segments.length ? { segments } : {}) };
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

export function color(value: unknown): string | undefined {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : undefined;
}

export function sanitizeFov(value: unknown): FieldOfView {
  const f = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    bearing: ((num(f.bearing) ?? 0) % 360 + 360) % 360,
    angle: Math.max(10, Math.min(120, num(f.angle) ?? 45)),
    range: Math.max(3, Math.min(100, num(f.range) ?? 25)),
  };
}

function sightingFields(r: Record<string, unknown>): Partial<import('../types').Waypoint> {
  const sex: SightingSex | undefined = r.sex === 'buck' || r.sex === 'doe' || r.sex === 'unknown' ? r.sex : undefined;
  const seenAt = num(r.seenAt);
  const photo = typeof r.photo === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(r.photo) && r.photo.length <= 200_000 ? r.photo : undefined;
  return {
    ...(sex ? { sex } : {}),
    ...(seenAt !== null && seenAt > 946_684_800_000 && seenAt < 4_102_444_800_000 ? { seenAt } : {}),
    ...(photo ? { photo } : {}),
  };
}

function windList(value: unknown): WindDir[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const found = new Set<string>();
  for (const item of value) if (typeof item === 'string') found.add(item);
  const winds = WIND_DIRS.filter(dir => found.has(dir));
  return winds.length ? winds : undefined;
}

function cameraFields(r: Record<string, unknown>): Partial<import('../types').Waypoint> {
  return {
    ...(r.fov && typeof r.fov === 'object' ? { fov: sanitizeFov(r.fov) } : {}),
    ...(typeof r.camera === 'string' ? { camera: r.camera.slice(0, 120) } : {}),
    ...(num(r.setAt) !== null && Number.isFinite(new Date(r.setAt as number).getTime()) ? { setAt: r.setAt as number } : {}),
    ...(num(r.checkedAt) !== null && Number.isFinite(new Date(r.checkedAt as number).getTime()) ? { checkedAt: r.checkedAt as number } : {}),
  };
}
