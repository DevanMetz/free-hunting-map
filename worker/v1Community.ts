import { HIDE_MARGIN } from '../src/community/vote';
import { HIKE_REPORT_THRESHOLD } from '../src/community/hike';
import { hikeFeature, type HikeRow } from './communityHikes';
import { decodeCursor, encodeCursor, parseBbox, parseLimit, V1Error, type V1Ctx } from './v1Shared';

const TRAIL_VISIBLE = `(override='show' OR (override IS NULL AND not_votes-real_votes<?))`;
const HIKE_VISIBLE = `withdrawn=0 AND deleted=0 AND geometry IS NOT NULL AND (override='show' OR (override IS NULL AND reports<?))`;

interface TrailRow { id: string; geometry: string; scan_count: number; model: string; confidence: number; first_seen: string; last_confirmed: string; real_votes: number; not_votes: number }

function trailFeature(row: TrailRow, types?: { type: string; count: number }[]) {
  const coordinates = JSON.parse(row.geometry) as [number, number][];
  return {
    type: 'Feature', id: row.id, geometry: { type: 'LineString', coordinates },
    properties: {
      id: row.id, scan_count: row.scan_count, model: row.model, confidence: row.confidence, first_seen: row.first_seen, last_confirmed: row.last_confirmed,
      votes: { real: row.real_votes, not: row.not_votes }, ...(types ? { types } : {}),
    },
  };
}

export async function communityTrails(ctx: V1Ctx): Promise<unknown> {
  const box = parseBbox(ctx.search.get('bbox'), 0.5);
  const limit = parseLimit(ctx.search.get('limit'), 500, 50);
  const cursor = ctx.search.get('cursor') ? decodeCursor(ctx.search.get('cursor')!) : '';
  const [west, south, east, north] = box;
  const rows = await ctx.env.DB.prepare(`SELECT id, geometry, scan_count, model, confidence, first_seen, last_confirmed, real_votes, not_votes FROM community_lines WHERE west<=? AND east>=? AND south<=? AND north>=? AND ${TRAIL_VISIBLE} AND id>? ORDER BY id LIMIT ?`).bind(east, west, north, south, HIDE_MARGIN, cursor, limit + 1).all<TrailRow>();
  const page = rows.results.slice(0, limit);
  const features = page.flatMap(row => { try { return [trailFeature(row)]; } catch { return []; } });
  return { type: 'FeatureCollection', next_cursor: rows.results.length > limit ? encodeCursor(rows.results[limit - 1]!.id) : null, features };
}

export async function communityTrail(ctx: V1Ctx): Promise<unknown> {
  const id = ctx.params.id ?? '';
  if (!/^[\w-]{1,64}$/.test(id)) throw new V1Error(404, 'not_found', 'Not found');
  const row = await ctx.env.DB.prepare(`SELECT id, geometry, scan_count, model, confidence, first_seen, last_confirmed, real_votes, not_votes FROM community_lines WHERE id=? AND ${TRAIL_VISIBLE}`).bind(id, HIDE_MARGIN).first<TrailRow>();
  if (!row) throw new V1Error(404, 'not_found', 'Not found');
  const types = await ctx.env.DB.prepare(`SELECT type, COUNT(*) AS n FROM community_votes WHERE line_id=? AND type IS NOT NULL AND type!='' GROUP BY type ORDER BY n DESC`).bind(id).all<{ type: string; n: number }>();
  try { return trailFeature(row, types.results.map(item => ({ type: item.type, count: item.n }))); }
  catch { throw new V1Error(404, 'not_found', 'Not found'); }
}

export async function communityHikes(ctx: V1Ctx): Promise<unknown> {
  const box = parseBbox(ctx.search.get('bbox'), 0.5);
  const limit = parseLimit(ctx.search.get('limit'), 500, 50);
  const cursor = ctx.search.get('cursor') ? decodeCursor(ctx.search.get('cursor')!) : '';
  const [west, south, east, north] = box;
  const rows = await ctx.env.DB.prepare(`SELECT id, geometry, month, name, type, distance FROM community_hikes WHERE west<=? AND east>=? AND south<=? AND north>=? AND ${HIKE_VISIBLE} AND id>? ORDER BY id LIMIT ?`).bind(east, west, north, south, HIKE_REPORT_THRESHOLD, cursor, limit + 1).all<HikeRow>();
  const page = rows.results.slice(0, limit);
  const features = page.flatMap(row => { try { return [hikeFeature({ ...row, reports: 0, override: null })]; } catch { return []; } });
  return { type: 'FeatureCollection', next_cursor: rows.results.length > limit ? encodeCursor(rows.results[limit - 1]!.id) : null, features };
}

export async function communityHike(ctx: V1Ctx): Promise<unknown> {
  const id = ctx.params.id ?? '';
  if (!/^[a-f0-9]{64}$/.test(id)) throw new V1Error(404, 'not_found', 'Not found');
  const row = await ctx.env.DB.prepare(`SELECT id, geometry, month, name, type, distance FROM community_hikes WHERE id=? AND ${HIKE_VISIBLE}`).bind(id, HIKE_REPORT_THRESHOLD).first<HikeRow>();
  if (!row?.geometry) throw new V1Error(404, 'not_found', 'Not found');
  try { return hikeFeature({ ...row, reports: 0, override: null }); }
  catch { throw new V1Error(404, 'not_found', 'Not found'); }
}
