import { sanitizeRecord, type SyncRecord } from '../src/sync/records';
import { mergeItem } from '../src/sync/merge';
export const MAX_BATCH = 100;
export const MAX_PAYLOAD = 1_000_000;
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function sync(db: D1Database, user: string, raw: unknown) {
  const body = raw as { cursor?: unknown; changes?: unknown };
  if (!body || !Number.isSafeInteger(body.cursor) || (body.cursor as number) < 0 || !Array.isArray(body.changes) || body.changes.length > MAX_BATCH) throw new ApiError(400, 'Invalid sync batch');
  const items: SyncRecord[] = body.changes.map(value => {
    if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_PAYLOAD) throw new ApiError(413, 'Item too large');
    const item = sanitizeRecord(value);
    if (!item || item.updatedAt > Date.now() + 300_000 || item.updatedAt < 0) throw new ApiError(400, 'Invalid item');
    return item;
  });
  for (const item of items) {
    let complete = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await db.prepare('SELECT payload,seq FROM items WHERE user_id=? AND id=?').bind(user, item.id).first<{ payload: string; seq: number }>();
      if (current && mergeItem(JSON.parse(current.payload) as SyncRecord, item) !== item) { complete = true; break; }
      if (!current) {
        const count = await db.prepare('SELECT count(*) AS n FROM items WHERE user_id=?').bind(user).first<{ n: number }>();
        if ((count?.n ?? 0) >= 50_000) throw new ApiError(413, 'Account item limit reached');
      }
      const mutation = crypto.randomUUID();
      const payload = JSON.stringify(item);
      // Conditional insert and upsert execute atomically in a D1 batch. A raced writer retries the pure merge.
      const results = await db.batch([
        db.prepare('INSERT INTO changes(mutation,user_id,payload) SELECT ?,?,? WHERE COALESCE((SELECT seq FROM items WHERE user_id=? AND id=?),0)=? AND (? > 0 OR (SELECT count(*) FROM items WHERE user_id=?) < 50000)').bind(mutation,user,payload,user,item.id,current?.seq ?? 0,current?.seq ?? 0,user),
        db.prepare('INSERT INTO items(user_id,id,kind,updated_at,deleted,payload,seq) SELECT ?,?,?,?,?,?,seq FROM changes WHERE mutation=? ON CONFLICT(user_id,id) DO UPDATE SET kind=excluded.kind,updated_at=excluded.updated_at,deleted=excluded.deleted,payload=excluded.payload,seq=excluded.seq').bind(user,item.id,item.kind,item.updatedAt,item.deleted ? 1 : 0,payload,mutation),
        db.prepare('DELETE FROM changes WHERE user_id=? AND seq=? AND EXISTS(SELECT 1 FROM changes WHERE mutation=?)').bind(user,current?.seq ?? 0,mutation),
      ]);
      if (results[0]?.meta.changes) { complete = true; break; }
    }
    if (!complete) throw new ApiError(409, 'Retry sync');
  }
  // Bound the SQL result before materializing payloads in Worker memory.
  const rows = await db.prepare('SELECT seq,payload FROM (SELECT seq,payload,SUM(length(CAST(payload AS BLOB))) OVER (ORDER BY seq) AS bytes FROM (SELECT seq,payload FROM changes WHERE user_id=? AND seq>? ORDER BY seq LIMIT 100)) WHERE bytes<=6000000 ORDER BY seq').bind(user,body.cursor).all<{ seq: number; payload: string }>();
  const cursor = rows.results.at(-1)?.seq ?? body.cursor as number;
  const more = await db.prepare('SELECT 1 AS present FROM changes WHERE user_id=? AND seq>? LIMIT 1').bind(user,cursor).first();
  return { cursor, changes: rows.results.map(row => JSON.parse(row.payload)), hasMore: !!more };
}
