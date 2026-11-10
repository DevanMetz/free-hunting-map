import { simplify } from '../src/community/geometry';
import { pathLength, roundCoord } from '../src/map/geo';
import { portablePreferences } from '../src/sync/records';
import type { LngLat } from '../src/types';
import { decodeCursor, encodeCursor, parseBbox, parseLimit, V1Error, type V1Ctx } from './v1Shared';

const SCAN_ROWS = 1000;
const SCAN_BYTES = 5_000_000;
type Mode = 'simplified' | 'full' | 'none';

function iso(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function coord(value: unknown): LngLat | null {
  if (!Array.isArray(value) || value.length < 2 || typeof value[0] !== 'number' || typeof value[1] !== 'number') return null;
  if (!(value[0] >= -180 && value[0] <= 180 && value[1] >= -90 && value[1] <= 90)) return null;
  return roundCoord([value[0], value[1]]);
}

function record(payload: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(payload) as unknown;
    return value && typeof value === 'object' ? value as Record<string, unknown> : null;
  } catch { return null; }
}

function intersects(box: [number, number, number, number] | null, query: [number, number, number, number] | null): boolean {
  if (!query) return true;
  if (!box) return false;
  return box[0] <= query[2] && box[2] >= query[0] && box[1] <= query[3] && box[3] >= query[1];
}

function boundsOf(coords: readonly LngLat[]): [number, number, number, number] | null {
  if (!coords.length) return null;
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const [lng, lat] of coords) { west = Math.min(west, lng); south = Math.min(south, lat); east = Math.max(east, lng); north = Math.max(north, lat); }
  return [west, south, east, north];
}

function linesOf(coords: LngLat[], segments: number[]): LngLat[][] {
  const cuts = [...new Set(segments.filter(n => Number.isInteger(n) && n > 0 && n < coords.length))].sort((a, b) => a - b);
  if (!cuts.length) return [coords];
  const starts = [0, ...cuts, coords.length];
  return starts.slice(0, -1).map((start, index) => coords.slice(start, starts[index + 1])).filter(line => line.length >= 2);
}

async function categoryNames(db: D1Database, userId: string): Promise<Map<string, string>> {
  const rows = await db.prepare(`SELECT payload FROM items WHERE user_id=? AND kind='category' AND deleted=0`).bind(userId).all<{ payload: string }>();
  const names = new Map<string, string>();
  for (const row of rows.results) {
    const item = record(row.payload);
    if (item && typeof item.id === 'string' && typeof item.name === 'string') names.set(item.id, item.name);
  }
  return names;
}

async function hikeState(db: D1Database, userId: string, trackIds: string[]): Promise<Map<string, { shared: boolean; id: string }>> {
  const state = new Map<string, { shared: boolean; id: string; at: number }>();
  if (!trackIds.length) return new Map();
  const marks = trackIds.map(() => '?').join(',');
  const rows = await db.prepare(`SELECT payload, updated_at FROM items WHERE user_id=? AND kind='community-hike' AND deleted=0 AND json_extract(payload,'$.trackId') IN (${marks})`).bind(userId, ...trackIds).all<{ payload: string; updated_at: number }>();
  for (const row of rows.results) {
    const item = record(row.payload);
    const trackId = typeof item?.trackId === 'string' ? item.trackId : '';
    const shareId = typeof item?.shareId === 'string' ? item.shareId : '';
    if (!trackId || !shareId) continue;
    const current = state.get(trackId);
    if (!current || row.updated_at >= current.at) state.set(trackId, { shared: item?.shared === true, id: shareId, at: row.updated_at });
  }
  return new Map([...state].map(([id, value]) => [id, { shared: value.shared, id: value.id }]));
}

function organization(item: Record<string, unknown>, names: Map<string, string>) {
  const category = typeof item.categoryId === 'string' ? names.get(item.categoryId) ?? null : typeof item.categoryName === 'string' ? item.categoryName : null;
  return {
    name: text(item.name), note: text(item.note), category, color: typeof item.color === 'string' ? item.color : null, hidden: item.hidden === true,
    created_at: iso(item.createdAt), updated_at: iso(item.updatedAt),
  };
}

function pinFeature(item: Record<string, unknown>, names: Map<string, string>, mode: Mode) {
  const point = coord(item.coord);
  if (!point || typeof item.id !== 'string') return null;
  return {
    type: 'Feature', id: item.id, geometry: mode === 'none' ? null : { type: 'Point', coordinates: point },
    properties: {
      kind: 'pin', ...organization(item, names), icon: typeof item.icon === 'string' ? item.icon : 'pin',
      source_url: typeof item.sourceUrl === 'string' ? item.sourceUrl : null, camera: typeof item.camera === 'string' ? item.camera : null,
      set_at: iso(item.setAt), checked_at: iso(item.checkedAt),
    },
  };
}

function trackFeature(item: Record<string, unknown>, names: Map<string, string>, mode: Mode, community: Map<string, { shared: boolean; id: string }>) {
  if (!Array.isArray(item.coords) || typeof item.id !== 'string') return null;
  const coords = item.coords.map(coord).filter((point): point is LngLat => !!point);
  if (coords.length !== item.coords.length) return null;
  const segments = Array.isArray(item.segments) ? item.segments.filter((n): n is number => Number.isInteger(n)) : [];
  const parts = linesOf(coords, segments);
  const geometry = mode === 'none' ? null : segments.length
    ? { type: 'MultiLineString', coordinates: mode === 'simplified' ? parts.map(line => simplify(line, 5)) : parts }
    : { type: 'LineString', coordinates: mode === 'simplified' ? simplify(coords, 5) : coords };
  const shared = community.get(item.id);
  return {
    type: 'Feature', id: item.id, geometry,
    properties: {
      kind: item.recorded === true ? 'recording' : 'trail', ...organization(item, names),
      distance_m: Math.round(pathLength(coords, segments)), point_count: coords.length, bbox: boundsOf(coords),
      ...(shared ? { community: shared } : {}),
    },
  };
}

function userId(ctx: V1Ctx): string {
  if (!ctx.key) throw new V1Error(401, 'unauthorized', 'API key required');
  return ctx.key.user_id;
}

function modeOf(value: string | null, fallback: Mode): Mode {
  if (value == null || value === '') return fallback;
  if (value === 'simplified' || value === 'full' || value === 'none') return value;
  throw new V1Error(400, 'invalid_request', 'Invalid geometry');
}

function sinceOf(value: string | null): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new V1Error(400, 'invalid_request', 'Invalid updated_since');
  return parsed;
}

export async function meSummary(ctx: V1Ctx): Promise<unknown> {
  const id = userId(ctx);
  const key = ctx.key!;
  const rows = await ctx.env.DB.prepare(`SELECT kind, json_extract(payload,'$.recorded') AS recorded, COUNT(*) AS n FROM items WHERE user_id=? AND deleted=0 GROUP BY kind, recorded`).bind(id).all<{ kind: string; recorded: number | null; n: number }>();
  const counts = { pins: 0, trails: 0, recordings: 0, categories: 0, lidar_scans: 0, settings: 0 };
  for (const row of rows.results) {
    if (row.kind === 'waypoint') counts.pins += row.n;
    else if (row.kind === 'track') { if (row.recorded === 1) counts.recordings += row.n; else counts.trails += row.n; }
    else if (row.kind === 'category') counts.categories += row.n;
    else if (row.kind === 'lidar-run') counts.lidar_scans += row.n;
    else if (row.kind === 'settings') counts.settings += row.n;
  }
  return { key: { id: key.id, name: key.name, prefix: key.prefix, scopes: key.scopes.split(','), created_at: iso(key.created_at), last_used_at: iso(key.last_used_at) }, counts };
}

async function listFeatures(ctx: V1Ctx, kind: 'waypoint' | 'track', recorded?: boolean) {
  const id = userId(ctx);
  const limit = parseLimit(ctx.search.get('limit'), 200, 50);
  const bbox = ctx.search.get('bbox') ? parseBbox(ctx.search.get('bbox'), 180) : null;
  const category = ctx.search.get('category');
  const mode = modeOf(ctx.search.get('geometry'), 'simplified');
  const since = sinceOf(ctx.search.get('updated_since'));
  let cursor = ctx.search.get('cursor') ? decodeCursor(ctx.search.get('cursor')!) : '';
  const names = await categoryNames(ctx.env.DB, id);
  const chosen: { id: string; payload: string }[] = [];
  let scanned = 0, bytes = 0, exhausted = false;
  while (chosen.length < limit && scanned < SCAN_ROWS && bytes < SCAN_BYTES) {
    const page = Math.min(100, SCAN_ROWS - scanned);
    const binds: (string | number)[] = [id, kind, cursor];
    let sql = `SELECT id, payload, updated_at FROM items WHERE user_id=? AND kind=? AND deleted=0 AND id>?`;
    if (recorded !== undefined) { sql += ` AND json_extract(payload,'$.recorded')=?`; binds.push(recorded ? 1 : 0); }
    if (since !== undefined) { sql += ` AND updated_at>?`; binds.push(since); }
    sql += ` ORDER BY id LIMIT ?`;
    binds.push(page);
    const rows = await ctx.env.DB.prepare(sql).bind(...binds).all<{ id: string; payload: string; updated_at: number }>();
    if (!rows.results.length) { exhausted = true; break; }
    let stop = false;
    for (const row of rows.results) {
      if (bytes + row.payload.length > SCAN_BYTES && scanned > 0) { stop = true; break; }
      scanned += 1;
      bytes += row.payload.length;
      cursor = row.id;
      const item = record(row.payload);
      if (item) {
        const name = typeof item.categoryId === 'string' ? names.get(item.categoryId) ?? null : typeof item.categoryName === 'string' ? item.categoryName : null;
        const point = kind === 'waypoint' ? coord(item.coord) : null;
        const coords = kind === 'track' && Array.isArray(item.coords) ? item.coords.map(coord).filter((value): value is LngLat => !!value) : [];
        const box = point ? [point[0], point[1], point[0], point[1]] as [number, number, number, number] : boundsOf(coords);
        if ((!category || name === category) && intersects(box, bbox)) chosen.push(row);
      }
      if (chosen.length >= limit || scanned >= SCAN_ROWS) { stop = true; break; }
    }
    if (stop || chosen.length >= limit || scanned >= SCAN_ROWS || bytes >= SCAN_BYTES) break;
    if (rows.results.length < page) { exhausted = true; break; }
  }
  const shares = kind === 'track' ? await hikeState(ctx.env.DB, id, chosen.map(row => row.id)) : new Map<string, { shared: boolean; id: string }>();
  const features = chosen.flatMap(row => {
    const item = record(row.payload);
    if (!item) return [];
    const feature = kind === 'waypoint' ? pinFeature(item, names, mode) : trackFeature(item, names, mode, shares);
    return feature ? [feature] : [];
  });
  return { type: 'FeatureCollection', next_cursor: exhausted ? null : encodeCursor(cursor), features };
}

export const mePins = (ctx: V1Ctx) => listFeatures(ctx, 'waypoint');
export const meTrails = (ctx: V1Ctx) => listFeatures(ctx, 'track', false);
export const meRecordings = (ctx: V1Ctx) => listFeatures(ctx, 'track', true);

export async function meItem(ctx: V1Ctx): Promise<unknown> {
  const id = userId(ctx);
  const itemId = ctx.params.id ?? '';
  if (!/^[\w:.-]{1,80}$/.test(itemId)) throw new V1Error(400, 'invalid_request', 'Invalid id');
  const row = await ctx.env.DB.prepare(`SELECT payload FROM items WHERE user_id=? AND id=? AND deleted=0 AND kind IN ('waypoint','track')`).bind(id, itemId).first<{ payload: string }>();
  const item = row ? record(row.payload) : null;
  if (!item) throw new V1Error(404, 'not_found', 'Not found');
  const names = await categoryNames(ctx.env.DB, id);
  const feature = item.kind === 'waypoint' ? pinFeature(item, names, 'full') : trackFeature(item, names, 'full', await hikeState(ctx.env.DB, id, [itemId]));
  if (!feature) throw new V1Error(404, 'not_found', 'Not found');
  return feature;
}

function lidarBox(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4 || value.some(n => typeof n !== 'number' || !Number.isFinite(n))) return null;
  const [west, south, east, north] = value as [number, number, number, number];
  if (!(west <= east) || !(south <= north)) return null;
  return [west, south, east, north];
}

export async function meLidarScans(ctx: V1Ctx): Promise<unknown> {
  const id = userId(ctx);
  const limit = parseLimit(ctx.search.get('limit'), 200, 50);
  const bbox = ctx.search.get('bbox') ? parseBbox(ctx.search.get('bbox'), 180) : null;
  let cursor = ctx.search.get('cursor') ? decodeCursor(ctx.search.get('cursor')!) : '';
  const features = [];
  let scanned = 0, bytes = 0, exhausted = false;
  while (features.length < limit && scanned < SCAN_ROWS && bytes < SCAN_BYTES) {
    const page = Math.min(100, SCAN_ROWS - scanned);
    const rows = await ctx.env.DB.prepare(`SELECT id, payload FROM items WHERE user_id=? AND kind='lidar-run' AND deleted=0 AND id>? ORDER BY id LIMIT ?`).bind(id, cursor, page).all<{ id: string; payload: string }>();
    if (!rows.results.length) { exhausted = true; break; }
    let stop = false;
    for (const row of rows.results) {
      if (bytes + row.payload.length > SCAN_BYTES && scanned > 0) { stop = true; break; }
      scanned += 1;
      bytes += row.payload.length;
      cursor = row.id;
      const item = record(row.payload);
      const box = lidarBox(item?.box);
      const count = Array.isArray((item?.candidates as { features?: unknown[] } | undefined)?.features) ? (item!.candidates as { features: unknown[] }).features.length : 0;
      if (box && intersects(box, bbox)) features.push({ type: 'Feature', id: row.id, geometry: { type: 'Polygon', coordinates: [[[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]], [box[0], box[1]]]] }, properties: { kind: 'lidar-scan', candidate_count: count, created_at: iso(item?.createdAt) } });
      if (features.length >= limit || scanned >= SCAN_ROWS) { stop = true; break; }
    }
    if (stop || features.length >= limit || scanned >= SCAN_ROWS || bytes >= SCAN_BYTES) break;
    if (rows.results.length < page) { exhausted = true; break; }
  }
  return { type: 'FeatureCollection', next_cursor: exhausted ? null : encodeCursor(cursor), features };
}

export async function meLidarScan(ctx: V1Ctx): Promise<unknown> {
  const id = userId(ctx);
  const itemId = ctx.params.id ?? '';
  if (!/^[\w:.-]{1,80}$/.test(itemId)) throw new V1Error(400, 'invalid_request', 'Invalid id');
  const row = await ctx.env.DB.prepare(`SELECT payload FROM items WHERE user_id=? AND id=? AND kind='lidar-run' AND deleted=0`).bind(id, itemId).first<{ payload: string }>();
  const item = row ? record(row.payload) : null;
  const candidates = item?.candidates as { type?: unknown; features?: unknown } | undefined;
  if (!item || candidates?.type !== 'FeatureCollection' || !Array.isArray(candidates.features)) throw new V1Error(404, 'not_found', 'Not found');
  return { type: 'FeatureCollection', id: itemId, bbox: lidarBox(item.box), created_at: iso(item.createdAt), features: candidates.features };
}

export async function meCategories(ctx: V1Ctx): Promise<unknown> {
  const id = userId(ctx);
  const rows = await ctx.env.DB.prepare(`SELECT payload FROM items WHERE user_id=? AND kind='category' AND deleted=0 ORDER BY id`).bind(id).all<{ payload: string }>();
  const categories = rows.results.flatMap(row => {
    const item = record(row.payload);
    if (!item || typeof item.id !== 'string' || typeof item.name !== 'string') return [];
    return [{ id: item.id, name: item.name, color: typeof item.color === 'string' ? item.color : null, icon: typeof item.icon === 'string' ? item.icon : null, hidden: item.hidden === true, sort: typeof item.sort === 'number' ? item.sort : null, created_at: iso(item.createdAt), updated_at: iso(item.updatedAt) }];
  });
  return { categories };
}

export async function meSettings(ctx: V1Ctx): Promise<unknown> {
  const id = userId(ctx);
  const row = await ctx.env.DB.prepare(`SELECT payload FROM items WHERE user_id=? AND id='settings:map' AND kind='settings' AND deleted=0`).bind(id).first<{ payload: string }>();
  const item = row ? record(row.payload) : null;
  return { preferences: portablePreferences(item?.preferences) };
}
