import { serveTiles } from './tiles';
import { recordUsage, usageReport } from './usage';
import { verifyGoogleToken } from './token';
import { ApiError, sync } from './sync';
export interface Env { DB: D1Database; TILES?: R2Bucket; ASSETS: Fetcher; GOOGLE_CLIENT_ID?: string; DEV_AUTH?: string; ADMIN_EMAILS?: string; USAGE?: AnalyticsEngineDataset }
// Random values are only allowed inside handlers; this salt lives for the isolate.
let pingSalt: string | undefined;
const COOKIE = '__Host-fhm_session';
const AGE = 45 * 86400;
const clearCookie = { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` };
const json = (value: unknown, status = 200, headers: HeadersInit = {}) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
const local = (url: URL) => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
async function hash(value: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), n => n.toString(16).padStart(2,'0')).join(''); }
function cookie(request: Request) { return request.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1); }
async function rate(db: D1Database, key: string, limit: number, userId?: string) {
  const window = Math.floor(Date.now()/60_000);
  const row = await db.prepare('INSERT INTO rate_limits(key,window,count) SELECT ?,?,1 WHERE (? IS NULL OR EXISTS(SELECT 1 FROM users WHERE id=?)) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END,window=excluded.window RETURNING count').bind(key,window,userId ?? null,userId ?? null).first<{ count: number }>();
  if ((row?.count ?? 0) > limit) throw new ApiError(429,'Too many requests');
}
async function user(request: Request, env: Env) {
  const token = cookie(request);
  if (!token || token.length > 128) return null;
  return env.DB.prepare('SELECT users.id,users.email,users.name,users.picture FROM sessions JOIN users ON sessions.user_id=users.id WHERE sessions.hash=? AND sessions.expires_at>?').bind(await hash(token),Date.now()).first<{id: string; email?: string; name?: string; picture?: string}>();
}
async function body(request: Request, cap = 8_000_000) {
  if (!request.headers.get('content-type')?.match(/^application\/json(?:\s*;|$)/i)) throw new ApiError(415,'JSON required');
  if (Number(request.headers.get('content-length')) > cap) throw new ApiError(413,'Request too large');
  const reader = request.body?.getReader();
  let size = 0; const chunks: Uint8Array[] = [];
  if (reader) while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > cap) { await reader.cancel(); throw new ApiError(413,'Request too large'); } chunks.push(part.value); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown; } catch { throw new ApiError(400,'Invalid JSON'); }
}
export default {
  async fetch(request: Request, env: Env, ctx?: Pick<ExecutionContext, 'waitUntil'>): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/tiles' || url.pathname.startsWith('/tiles/')) return serveTiles(request, env.TILES, ctx);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      if (request.method === 'POST') {
        // Comparing to the actual request origin prevents cross-domain cookies/authentication attacks.
        const origin = request.headers.get('origin');
        const allowed = ['https://freehuntingmap.com','https://www.freehuntingmap.com','https://open-hunt-map.metzdevan.workers.dev'].includes(url.origin) || local(url);
        if (!allowed || origin !== url.origin) throw new ApiError(403,'Invalid origin');
      }
      if (request.method === 'GET' && url.pathname === '/api/config') return json({ googleClientId: env.GOOGLE_CLIENT_ID || null });
      if (request.method === 'GET' && url.pathname === '/api/me') return json({ user: await user(request,env) });
      if (request.method === 'GET' && url.pathname === '/api/admin/usage') {
        const account = await user(request,env);
        if (!account) throw new ApiError(401,'Sign in required');
        if (!account.email || !(env.ADMIN_EMAILS ?? 'metzdevan@gmail.com').split(',').map(v=>v.trim().toLowerCase()).includes(account.email.toLowerCase())) throw new ApiError(403,'Forbidden');
        return json(await usageReport(env.DB));
      }
      if (request.method !== 'POST') return json({ error:'Not found' },404);
      if (['/api/ping','/api/events'].includes(url.pathname)) {
        const events=url.pathname==='/api/events';
        const input=await body(request,events?8192:1024);
        await rate(env.DB,`ping:${await hash((pingSalt ??= crypto.randomUUID()) + (request.headers.get('CF-Connecting-IP') ?? 'local'))}`,30);
        return await recordUsage(input,request,env,events);
      }
      const input = await body(request);
      if (url.pathname === '/api/auth/google') {
        await rate(env.DB,`auth:${await hash(request.headers.get('CF-Connecting-IP') ?? 'local')}`,20);
        const credential = (input as {credential?: unknown})?.credential;
        if (typeof credential !== 'string') throw new ApiError(400,'Credential required');
        let identity;
        try {
          if (env.DEV_AUTH === '1' && local(url) && credential.startsWith('dev:') && /^[a-zA-Z0-9_-]{1,64}$/.test(credential.slice(4))) identity = { sub: credential.slice(4), name: credential.slice(4) };
          else { if (!env.GOOGLE_CLIENT_ID) throw new Error('Not configured'); identity = await verifyGoogleToken(credential,env.GOOGLE_CLIENT_ID); }
        } catch { throw new ApiError(401,'Invalid credential'); }
        const account = { id: identity.sub, email: identity.email ?? null, name: identity.name ?? null, picture: identity.picture ?? null };
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        const token = Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');
        await env.DB.batch([
          env.DB.prepare('INSERT INTO users(id,email,name,picture) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,name=excluded.name,picture=excluded.picture').bind(account.id,account.email,account.name,account.picture),
          env.DB.prepare('INSERT INTO sessions(hash,user_id,expires_at) VALUES(?,?,?)').bind(await hash(token),account.id,Date.now()+AGE*1000),
          env.DB.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(Date.now()),
          env.DB.prepare('DELETE FROM rate_limits WHERE window<?').bind(Math.floor(Date.now()/60_000)-60),
        ]);
        return json({user:account},200,{'Set-Cookie':`${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${AGE}`});
      }
      if (url.pathname === '/api/auth/logout') {
        const token = cookie(request);
        if (token) await env.DB.prepare('DELETE FROM sessions WHERE hash=?').bind(await hash(token)).run();
        return json({user:null},200,clearCookie);
      }
      if (url.pathname === '/api/account/delete') {
        const account = await user(request, env);
        if (!account) throw new ApiError(401, 'Sign in required');
        await env.DB.batch([
          env.DB.prepare('DELETE FROM items WHERE user_id=?').bind(account.id),
          env.DB.prepare('DELETE FROM changes WHERE user_id=?').bind(account.id),
          env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(account.id),
          env.DB.prepare('DELETE FROM rate_limits WHERE key=?').bind(`sync:${account.id}`),
          env.DB.prepare('DELETE FROM users WHERE id=?').bind(account.id),
        ]);
        return json({ user: null }, 200, clearCookie);
      }
      if (url.pathname === '/api/sync') {
        const account = await user(request,env);
        if (!account) throw new ApiError(401,'Sign in required');
        await rate(env.DB,`sync:${account.id}`,120,account.id);
        return json(await sync(env.DB,account.id,input));
      }
      return json({error:'Not found'},404);
    } catch (error) {
      if (error instanceof ApiError) return json({error:error.message},error.status);
      console.error('API request failed', error);
      return json({error:'Request failed'},500);
    }
  },
};
