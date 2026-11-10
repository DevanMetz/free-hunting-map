import type { Env } from './index';
import { lookupKey, touchKey } from './v1Keys';
import { handleMcp } from './v1Mcp';
import { openApiDocument } from './v1Openapi';
import { findOperation } from './v1Ops';
import { bearer, limitBinding, readJson, V1Error, type V1Ctx } from './v1Shared';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
};

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS)) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function errorResponse(error: V1Error): Response {
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
  if (error.status === 429) headers['Retry-After'] = '60';
  return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status, headers });
}

export async function apiV1(request: Request, env: Env, exec?: Pick<ExecutionContext, 'waitUntil'>): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
  let name = pathname.slice('/api/v1'.length).replace(/^\//, '').replaceAll('/', '_') || 'index';
  let authed = false;
  const send = (response: Response, op = name) => {
    try { env.USAGE?.writeDataPoint({ indexes: ['api'], blobs: [op, authed ? 'key' : 'anon', String(response.status)] }); } catch { /* Analytics are optional. */ }
    return withCors(response);
  };
  try {
    if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Max-Age': '86400' } }));
    const token = bearer(request);
    const key = token ? await lookupKey(env.DB, token) : null;
    if (token && (!key || !key.scopes.split(',').includes('read'))) throw new V1Error(401, 'unauthorized', 'Invalid API key');
    if (key) touchKey(env.DB, key, exec);
    authed = !!key;
    const actor = key?.id ?? request.headers.get('CF-Connecting-IP') ?? 'local';
    if (pathname === '/api/v1/mcp') return send(await handleMcp(request, env, exec, key, url), 'mcp');
    await limitBinding(key ? env.RL_KEY : env.RL_ANON, actor);
    if (request.method === 'GET' && pathname === '/api/v1') {
      return send(Response.json({ name: 'Free Hunting Map', version: '1', openapi: '/api/v1/openapi.json', mcp: '/api/v1/mcp', llms: '/llms.txt' }, { headers: { 'Cache-Control': 'no-store' } }), 'index');
    }
    if (request.method === 'GET' && pathname === '/api/v1/openapi.json') {
      return send(Response.json(openApiDocument(), { headers: { 'Cache-Control': 'public, max-age=3600' } }), 'openapi');
    }
    const found = findOperation(request.method, pathname);
    if (found === 'method') return send(errorResponse(new V1Error(405, 'invalid_request', 'Method not allowed')));
    if (!found) return send(errorResponse(new V1Error(404, 'not_found', 'Not found')));
    name = found.op.id;
    if (found.op.auth === 'key' && !key) throw new V1Error(401, 'unauthorized', 'API key required');
    const ctx: V1Ctx = { request, url, env, exec, key, params: found.params, search: url.searchParams, body: found.op.method === 'POST' ? await readJson(request, found.op.body?.limit ?? 65_536) : null };
    const value = await found.op.handler(ctx);
    const cached = found.op.path.startsWith('/terrain') || found.op.path.startsWith('/land');
    return send(Response.json(value, { headers: { 'Cache-Control': cached ? 'public, max-age=86400' : 'no-store' } }), found.op.id);
  } catch (error) {
    const failure = error instanceof V1Error ? error : new V1Error(500, 'upstream_unavailable', 'Request failed');
    if (!(error instanceof V1Error)) console.error('API v1 failed');
    return send(errorResponse(failure), name);
  }
}
