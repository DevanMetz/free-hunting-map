import { decodeHike, encodeHike, validHikeId, type WireHike } from '../community/hike';
import type { Category, Item, ItemMeta } from '../types';
import type { LidarRun } from '../storage/db';
import { sanitizeItem, lngLat, color, isWaypointIcon } from './validate';

export interface PreferenceRecord extends ItemMeta {
  kind: 'settings';
  preferences: Record<string, unknown>;
}
export interface LidarRecord extends ItemMeta, LidarRun { kind: 'lidar-run' }
export interface HikeRecord extends ItemMeta {
  kind: 'community-hike'; trackId: string; shareId: string; secret: string; shared: boolean; hike: WireHike;
}
export type SyncRecord = Item | Category | PreferenceRecord | LidarRecord | HikeRecord;
const booleans = ['hillshade', 'trails', 'parcels', 'water', 'deerUnits', 'labels', 'showPins', 'showTrails', 'showRecordings'];
const lands = ['usfs', 'blm', 'nps', 'fws', 'stateWildlife', 'statePark', 'stateTrust', 'dod', 'other'];

/** Only portable map preferences; viewport, cached data and device state stay local. */
export function portablePreferences(value: unknown): Record<string, unknown> {
  const r = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const out: Record<string, unknown> = {};
  for (const key of booleans) if (typeof r[key] === 'boolean') out[key] = r[key];
  if (['topo', 'satellite', 'streets'].includes(String(r.basemap))) out.basemap = r.basemap;
  if (typeof r.labelScale === 'number' && Number.isFinite(r.labelScale)) out.labelScale = Math.max(0.5, Math.min(2, r.labelScale));
  if (r.publicLand && typeof r.publicLand === 'object') {
    const p = r.publicLand as Record<string, unknown>;
    out.publicLand = Object.fromEntries(lands.filter(k => typeof p[k] === 'boolean').map(k => [k, p[k]]));
  }
  if (r.layers && typeof r.layers === 'object') {
    out.layers = Object.fromEntries(Object.entries(r.layers).flatMap(([id, value]) => {
      const v = value as Record<string, unknown> | null;
      return id.length <= 120 && v && typeof v.on === 'boolean' && typeof v.opacity === 'number' && Number.isFinite(v.opacity)
        ? [[id, { on: v.on, ...(typeof v.variant === 'string' && v.variant.length <= 120 ? { variant: v.variant } : {}), opacity: Math.max(0, Math.min(1, v.opacity)) }]] : [];
    }));
  }
  if (r.collapsed && typeof r.collapsed === 'object') out.collapsed = Object.fromEntries(Object.entries(r.collapsed).filter(([, v]) => typeof v === 'boolean'));
  if (r.remembered && typeof r.remembered === 'object') out.remembered = Object.fromEntries(Object.entries(r.remembered).flatMap(([id, v]) =>
    Array.isArray(v) ? [[id, v.filter((s): s is string => typeof s === 'string' && s.length <= 120).slice(0, 200)]] : []));
  return out;
}

export function sanitizeRecord(raw: unknown): SyncRecord | null {
  const item = sanitizeItem(raw);
  if (item) return item;
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  // Reuse the item metadata boundary as well as the exact item merge rules.
  const probe = sanitizeItem({ ...r, kind: 'waypoint', coord: [0, 0] });
  if (!probe) return null;
  const { id, createdAt, updatedAt, deviceId, deleted } = probe;
  const meta = { id, createdAt, updatedAt, deviceId, deleted };
  if (r.kind === 'community-hike') {
    if (typeof r.trackId !== 'string' || r.trackId.length < 8 || r.trackId.length > 64 || id !== r.shareId || !validHikeId(r.shareId) || !validHikeId(r.secret) || typeof r.shared !== 'boolean') return null;
    try { const hike=decodeHike(r.hike); return {...meta,kind:'community-hike',trackId:r.trackId,shareId:r.shareId,secret:r.secret,shared:r.shared,hike:encodeHike(hike.coordinates,hike.month,hike.name,hike.type)}; } catch { return null; }
  }
  if (r.kind === 'category') {
    if (typeof r.name !== 'string' || !r.name.trim()) return null;
    return { ...meta, kind: 'category', name: r.name.trim().slice(0, 120), hidden: r.hidden === true,
      ...(color(r.color) ? { color: color(r.color) } : {}),
      ...(isWaypointIcon(r.icon) ? { icon: r.icon } : {}),
      ...(typeof r.sort === 'number' && Number.isFinite(r.sort) ? { sort: r.sort } : {}) };
  }
  if (r.kind === 'settings' && id === 'settings:map') return { ...meta, kind: 'settings', preferences: portablePreferences(r.preferences) };
  if (r.kind !== 'lidar-run' || !Array.isArray(r.box) || r.box.length !== 4 || !r.box.every(v => typeof v === 'number' && Number.isFinite(v))) return null;
  const [west, south, east, north] = r.box as number[];
  if (!lngLat([west, south]) || !lngLat([east, north]) || west! > east! || south! > north!) return null;
  const candidates = r.candidates as LidarRun['candidates'] | undefined;
  if (candidates?.type !== 'FeatureCollection' || !Array.isArray(candidates.features) || candidates.features.length > 10000) return null;
  const features: LidarRun['candidates']['features'] = [];
  let count = 0;
  for (const f of candidates.features) {
    if (f?.type !== 'Feature' || f.geometry?.type !== 'LineString' || !Array.isArray(f.geometry.coordinates)) return null;
    count += f.geometry.coordinates.length;
    if (count > 100000) return null;
    const coordinates = f.geometry.coordinates.map(lngLat);
    if (coordinates.some(p => !p)) return null;
    if (!f.properties || !['rank', 'score', 'calibrated', 'length'].every(k => typeof (f.properties as unknown as Record<string, unknown>)[k] === 'number' && Number.isFinite((f.properties as unknown as Record<string, unknown>)[k]))) return null;
    const { rank, score, calibrated, length } = f.properties;
    features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coordinates as number[][] }, properties: { rank, score, calibrated, length, status: 'Unverified candidate' } });
  }
  return { ...meta, kind: 'lidar-run', box: r.box as LidarRun['box'], candidates: { type: 'FeatureCollection', features } };
}
