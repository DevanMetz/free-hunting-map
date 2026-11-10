import { ApiError } from './sync';
import { sha256, type ApiKeyRow } from './v1Shared';

const NAME = /[\u0000-\u001f\u007f]/g;

export function keyName(raw: unknown): string {
  if (typeof raw !== 'string') throw new ApiError(400, 'Name required');
  const name = raw.replace(NAME, '').trim();
  if (!name) throw new ApiError(400, 'Name required');
  if (name.length > 40) throw new ApiError(400, 'Name is too long');
  return name;
}

export async function lookupKey(db: D1Database, token: string): Promise<ApiKeyRow | null> {
  return db.prepare('SELECT id, user_id, name, prefix, scopes, created_at, last_used_at FROM api_keys WHERE hash=?').bind(await sha256(token)).first<ApiKeyRow>();
}

export function touchKey(db: D1Database, key: ApiKeyRow, exec?: Pick<ExecutionContext, 'waitUntil'>): void {
  const now = Date.now();
  if (key.last_used_at != null && now - key.last_used_at < 3_600_000) return;
  const pending = db.prepare('UPDATE api_keys SET last_used_at=? WHERE id=? AND (last_used_at IS NULL OR last_used_at<=?)').bind(now, key.id, now - 3_600_000).run();
  if (exec) exec.waitUntil(pending);
}

export async function listKeys(db: D1Database, userId: string) {
  const rows = await db.prepare('SELECT id, name, prefix, created_at, last_used_at FROM api_keys WHERE user_id=? ORDER BY created_at, id').bind(userId).all<{ id: string; name: string; prefix: string; created_at: number; last_used_at: number | null }>();
  return { keys: rows.results };
}

export async function createKey(db: D1Database, userId: string, raw: unknown) {
  const name = keyName((raw as { name?: unknown } | null)?.name);
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const hex = [...bytes].map(n => n.toString(16).padStart(2, '0')).join('');
  const key = `fhm_${hex}`;
  const prefix = `fhm_${hex.slice(0, 6)}`;
  const id = crypto.randomUUID();
  const inserted = await db.prepare(`INSERT INTO api_keys (id, hash, user_id, name, prefix, scopes, created_at)
    SELECT ?, ?, ?, ?, ?, 'read', ? WHERE (SELECT COUNT(*) FROM api_keys WHERE user_id=?) < 5`).bind(id, await sha256(key), userId, name, prefix, Date.now(), userId).run();
  if (!inserted.meta.changes) throw new ApiError(400, 'Key limit reached');
  return { key, id, name, prefix };
}

export async function revokeKey(db: D1Database, userId: string, raw: unknown) {
  const id = (raw as { id?: unknown } | null)?.id;
  if (typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id)) throw new ApiError(400, 'Invalid key');
  const result = await db.prepare('DELETE FROM api_keys WHERE id=? AND user_id=?').bind(id, userId).run();
  if (!result.meta.changes) throw new ApiError(404, 'Key not found');
  return { revoked: true };
}
