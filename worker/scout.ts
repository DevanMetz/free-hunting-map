import { sha256 } from './communityShared';
import { ApiError } from './sync';
import { mergeItem } from '../src/sync/merge';
import { sanitizeItem } from '../src/sync/validate';
import { ACTIVITY_DELAY_MS, activityTiles, cellRing, shareableIcon, validPartyId, validPartySecret } from '../src/scout/grid';
import type { Item } from '../src/types';

const BATCH = 20;
const ITEM_BYTES = 250_000;
const GROUP_LIMIT = 5_000;
let salt: string | undefined;

function bearer(request: Request): string {
  const match = /^Bearer ([0-9a-f]{64})$/i.exec(request.headers.get('authorization') ?? '');
  return match?.[1]?.toLowerCase() ?? '';
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length || !a.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const edgeCache = (): Cache | undefined => typeof caches !== 'undefined' && 'default' in caches ? (caches as CacheStorage & { default: Cache }).default : undefined;

async function limit(db: D1Database, request: Request, bucket: string, max: number): Promise<void> {
  salt ??= crypto.randomUUID();
  const window = Math.floor(Date.now() / 60_000);
  const key = `${bucket}:${await sha256(`${salt}:${bucket}:${request.headers.get('CF-Connecting-IP') ?? 'local'}`)}`;
  const row = await db.prepare('INSERT INTO rate_limits(key,window,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END, window=excluded.window RETURNING count').bind(key, window).first<{ count: number }>();
  if ((row?.count ?? 0) > max) throw new ApiError(429, 'Too many requests');
  if (window % 10 === 0) await db.prepare("DELETE FROM rate_limits WHERE key LIKE 'scout-%' AND window < ?").bind(window - 5).run();
}

async function party(db: D1Database, request: Request, id: string): Promise<{ name: string }> {
  const secret = bearer(request);
  if (!validPartySecret(secret) || !validPartyId(id)) throw new ApiError(403, 'Forbidden');
  const row = await db.prepare('SELECT secret_hash, name FROM scout_groups WHERE id=?').bind(id).first<{ secret_hash: string; name: string }>();
  if (!row) throw new ApiError(404, 'Party not found');
  if (!same(row.secret_hash, await sha256(secret))) throw new ApiError(403, 'Forbidden');
  return { name: row.name };
}

export async function createScoutGroup(request: Request, db: D1Database, raw: unknown): Promise<Response> {
  await limit(db, request, 'scout-create', 10);
  const body = raw as { id?: unknown; name?: unknown } | null;
  const secret = bearer(request);
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 40) : '';
  if (!validPartySecret(secret) || typeof body?.id !== 'string' || !validPartyId(body.id) || !name) throw new ApiError(400, 'Invalid party');
  const hash = await sha256(secret);
  await db.prepare('INSERT INTO scout_groups (id, secret_hash, name, created_at) VALUES (?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(body.id, hash, name, Date.now()).run();
  const row = await db.prepare('SELECT secret_hash, name FROM scout_groups WHERE id=?').bind(body.id).first<{ secret_hash: string; name: string }>();
  if (!row || !same(row.secret_hash, hash)) throw new ApiError(409, 'Party exists');
  return Response.json({ name: row.name }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function syncScout(request: Request, db: D1Database, raw: unknown): Promise<Response> {
  await limit(db, request, 'scout-sync', 60);
  const body = raw as { id?: unknown; cursor?: unknown; changes?: unknown } | null;
  if (!body || typeof body.id !== 'string' || !Number.isSafeInteger(body.cursor) || (body.cursor as number) < 0 || !Array.isArray(body.changes) || body.changes.length > BATCH) throw new ApiError(400, 'Invalid sync batch');
  const group = await party(db, request, body.id);
  const items: Item[] = body.changes.map(value => {
    if (new TextEncoder().encode(JSON.stringify(value)).length > ITEM_BYTES) throw new ApiError(413, 'Item too large');
    const item = sanitizeItem(value);
    if (!item || item.kind !== 'waypoint' || item.updatedAt > Date.now() + 300_000 || item.updatedAt < 0) throw new ApiError(400, 'Invalid item');
    if (!item.deleted && !shareableIcon(item.icon)) throw new ApiError(400, 'Invalid item');
    return item;
  });
  const resolved: unknown[] = [];
  for (const item of items) {
    let complete = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await db.prepare('SELECT payload, seq FROM scout_items WHERE group_id=? AND id=?').bind(body.id, item.id).first<{ payload: string; seq: number }>();
      if (current && mergeItem(JSON.parse(current.payload) as Item, item) !== item) {
        resolved.push(JSON.parse(current.payload) as unknown);
        complete = true;
        break;
      }
      if (!current) {
        const count = await db.prepare('SELECT count(*) AS n FROM scout_items WHERE group_id=?').bind(body.id).first<{ n: number }>();
        if ((count?.n ?? 0) >= GROUP_LIMIT) throw new ApiError(413, 'Party item limit reached');
      }
      const mutation = crypto.randomUUID();
      const payload = JSON.stringify(item);
      const results = await db.batch([
        db.prepare('INSERT INTO scout_changes(mutation,group_id,payload) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM scout_groups WHERE id=?) AND COALESCE((SELECT seq FROM scout_items WHERE group_id=? AND id=?),0)=? AND (? > 0 OR (SELECT count(*) FROM scout_items WHERE group_id=?) < 5000)').bind(mutation, body.id, payload, body.id, body.id, item.id, current?.seq ?? 0, current?.seq ?? 0, body.id),
        db.prepare('INSERT INTO scout_items(group_id,id,kind,updated_at,deleted,payload,seq) SELECT ?,?,?,?,?,?,seq FROM scout_changes WHERE mutation=? ON CONFLICT(group_id,id) DO UPDATE SET kind=excluded.kind,updated_at=excluded.updated_at,deleted=excluded.deleted,payload=excluded.payload,seq=excluded.seq').bind(body.id, item.id, item.kind, item.updatedAt, item.deleted ? 1 : 0, payload, mutation),
        db.prepare('DELETE FROM scout_changes WHERE group_id=? AND seq=? AND EXISTS(SELECT 1 FROM scout_changes WHERE mutation=?)').bind(body.id, current?.seq ?? 0, mutation),
      ]);
      if (results[0]?.meta.changes) { complete = true; break; }
    }
    if (!complete) throw new ApiError(409, 'Retry sync');
  }
  const rows = await db.prepare('SELECT seq,payload FROM (SELECT seq,payload,SUM(length(CAST(payload AS BLOB))) OVER (ORDER BY seq) AS bytes FROM (SELECT seq,payload FROM scout_changes WHERE group_id=? AND seq>? ORDER BY seq LIMIT 100)) WHERE bytes<=6000000 ORDER BY seq').bind(body.id, body.cursor).all<{ seq: number; payload: string }>();
  const cursor = rows.results.at(-1)?.seq ?? body.cursor as number;
  const more = await db.prepare('SELECT 1 AS present FROM scout_changes WHERE group_id=? AND seq>? LIMIT 1').bind(body.id, cursor).first();
  return Response.json({
    name: group.name,
    cursor,
    changes: rows.results.map(row => JSON.parse(row.payload) as unknown),
    resolved,
    hasMore: !!more,
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function publishActivity(request: Request, db: D1Database, raw: unknown): Promise<Response> {
  await limit(db, request, 'scout-activity', 20);
  const hits = (raw as { hits?: unknown } | null)?.hits;
  if (!Array.isArray(hits) || hits.length > 20) throw new ApiError(400, 'Invalid activity');
  const available = Date.now() + ACTIVITY_DELAY_MS;
  let accepted = 0;
  for (const hit of hits) {
    const id = (hit as { id?: unknown } | null)?.id;
    const cell = (hit as { cell?: unknown } | null)?.cell;
    if (typeof id !== 'string' || !validPartyId(id) || typeof cell !== 'string' || !cellRing(cell)) continue;
    const tiles = activityTiles(cell);
    if (!tiles.length) continue;
    const inserted = await db.prepare('INSERT INTO activity_hits (id, cell, available_at) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING').bind(id, cell, available).run();
    await db.batch(tiles.map(tile => db.prepare('INSERT OR IGNORE INTO activity_tiles (tile, hit_id) VALUES (?,?)').bind(tile, id)));
    if (inserted.meta.changes) accepted++;
  }
  return Response.json({ accepted }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
}

export async function activityTile(request: Request, db: D1Database): Promise<Response> {
  const url = new URL(request.url);
  const match = /^\/tiles\/activity\/8\/(\d+)\/(\d+)\.geojson$/.exec(url.pathname);
  const x = Number(match?.[1]);
  const y = Number(match?.[2]);
  if (request.method !== 'GET' || !match || x > 255 || y > 255) return new Response(null, { status: 404 });
  const cacheKey = new Request(`${url.origin}${url.pathname}`);
  const edge = edgeCache();
  if (edge) {
    const cached = await edge.match(cacheKey);
    if (cached) return cached;
  }
  const rows = await db.prepare('SELECT h.cell AS cell, COUNT(*) AS n FROM activity_tiles t JOIN activity_hits h ON h.id = t.hit_id WHERE t.tile = ? AND h.available_at <= ? GROUP BY h.cell').bind(`${x}/${y}`, Date.now()).all<{ cell: string; n: number }>();
  const features = [];
  for (const row of rows.results) {
    const ring = cellRing(row.cell);
    if (!ring || row.n < 1) continue;
    features.push({ type: 'Feature', id: row.cell, geometry: { type: 'Polygon', coordinates: [ring] }, properties: { count: row.n } });
  }
  const response = Response.json({ type: 'FeatureCollection', features }, { headers: { 'Cache-Control': 'public, max-age=300', 'Content-Type': 'application/geo+json; charset=utf-8' } });
  if (edge) await edge.put(cacheKey, response.clone());
  return response;
}
