import type { LngLat } from '../src/types';
import { inSupportedUS } from '../src/community/geometry';

export class V1Error extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export interface ApiKeyRow {
  id: string;
  user_id: string;
  name: string;
  prefix: string;
  scopes: string;
  created_at: number;
  last_used_at: number | null;
}

export interface V1Env {
  DB: D1Database;
  ASSETS: Fetcher;
  USAGE?: AnalyticsEngineDataset;
  RL_ANON?: RateLimit;
  RL_KEY?: RateLimit;
  RL_UPSTREAM?: RateLimit;
}

export interface V1Ctx {
  request: Request;
  url: URL;
  env: V1Env;
  exec?: Pick<ExecutionContext, 'waitUntil'>;
  key: ApiKeyRow | null;
  body: unknown;
  params: Record<string, string>;
  search: URLSearchParams;
}

export interface ParamSpec {
  name: string;
  in: 'query' | 'path';
  required?: boolean;
  schema: Record<string, unknown>;
  description?: string;
}

export interface Operation {
  id: string;
  method: 'GET' | 'POST';
  path: string;
  summary: string;
  auth: 'none' | 'optional' | 'key';
  params: ParamSpec[];
  body?: { schema: Record<string, unknown>; limit: number };
  handler: (ctx: V1Ctx) => Promise<unknown>;
}

export const UA = 'FreeHuntingMap-API';
const KEY_RE = /^fhm_[a-f0-9]{64}$/;

export async function sha256(value: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(n => n.toString(16).padStart(2, '0')).join('');
}

export function actor(ctx: V1Ctx): string {
  return ctx.key?.id ?? ctx.request.headers.get('CF-Connecting-IP') ?? 'local';
}

export async function limitBinding(binding: RateLimit | undefined, key: string): Promise<void> {
  if (!binding) return;
  const result = await binding.limit({ key });
  if (!result.success) throw new V1Error(429, 'rate_limited', 'Too many requests');
}

export function round5(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

export function num(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function parseLatLng(search: URLSearchParams): { lat: number; lng: number } {
  const lat = num(search.get('lat')), lng = num(search.get('lng'));
  if (lat == null || lng == null || lat < -90 || lat > 90 || lng < -180 || lng > 180) throw new V1Error(400, 'invalid_request', 'Invalid coordinates');
  return { lat: round5(lat), lng: round5(lng) };
}

export function requireCoverage(lng: number, lat: number): void {
  if (!inSupportedUS([lng, lat])) throw new V1Error(422, 'out_of_coverage', 'Outside supported coverage');
}

export function parseBbox(value: string | null, maxSpan: number): [number, number, number, number] {
  const parts = value?.split(',').map(part => Number(part.trim())) ?? [];
  if (parts.length !== 4 || parts.some(n => !Number.isFinite(n))) throw new V1Error(400, 'invalid_request', 'Invalid bbox');
  const [west, south, east, north] = parts as [number, number, number, number];
  if (south < -90 || north > 90 || west < -180 || east > 180 || !(west < east) || !(south < north)) throw new V1Error(400, 'invalid_request', 'Invalid bbox');
  if (east - west > maxSpan + 1e-9 || north - south > maxSpan + 1e-9) throw new V1Error(400, 'invalid_request', 'Bbox is too large');
  const box: [number, number, number, number] = [round5(west), round5(south), round5(east), round5(north)];
  if (!(box[0] < box[2]) || !(box[1] < box[3])) throw new V1Error(400, 'invalid_request', 'Invalid bbox');
  return box;
}

export function bboxCovered(box: [number, number, number, number]): void {
  const corners: LngLat[] = [[box[0], box[1]], [box[2], box[1]], [box[0], box[3]], [box[2], box[3]]];
  if (corners.some(point => !inSupportedUS(point))) throw new V1Error(422, 'out_of_coverage', 'Outside supported coverage');
}

export function parsePath(value: string | null): LngLat[] {
  const parts = value?.split(';').filter(Boolean) ?? [];
  if (!parts.length) throw new V1Error(400, 'invalid_request', 'Path required');
  return parts.map(part => {
    const [lng, lat] = part.split(',').map(item => Number(item.trim()));
    if (lng == null || lat == null || !Number.isFinite(lng) || !Number.isFinite(lat) || lat < -90 || lat > 90 || lng < -180 || lng > 180) throw new V1Error(400, 'invalid_request', 'Invalid path');
    return [round5(lng), round5(lat)] as LngLat;
  });
}

export function lineStringCoords(geometry: unknown): LngLat[] {
  const feature = geometry as { type?: unknown; coordinates?: unknown } | null;
  if (!feature || feature.type !== 'LineString' || !Array.isArray(feature.coordinates)) throw new V1Error(400, 'invalid_request', 'LineString required');
  return feature.coordinates.map(point => {
    if (!Array.isArray(point) || point.length < 2) throw new V1Error(400, 'invalid_request', 'Invalid path');
    const lng = point[0], lat = point[1];
    if (typeof lng !== 'number' || typeof lat !== 'number' || !Number.isFinite(lng) || !Number.isFinite(lat) || lat < -90 || lat > 90 || lng < -180 || lng > 180) throw new V1Error(400, 'invalid_request', 'Invalid path');
    return [round5(lng), round5(lat)] as LngLat;
  });
}

export function parseLimit(value: string | null, max: number, fallback: number): number {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) throw new V1Error(400, 'invalid_request', 'Invalid limit');
  return n;
}

export function encodeCursor(id: string): string {
  return btoa(id).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function decodeCursor(cursor: string): string {
  if (!/^[\w-]{1,200}$/.test(cursor)) throw new V1Error(400, 'invalid_request', 'Invalid cursor');
  const pad = '='.repeat((4 - cursor.length % 4) % 4);
  let id = '';
  try { id = atob(cursor.replaceAll('-', '+').replaceAll('_', '/') + pad); } catch { throw new V1Error(400, 'invalid_request', 'Invalid cursor'); }
  if (!/^[\w:.-]{1,80}$/.test(id)) throw new V1Error(400, 'invalid_request', 'Invalid cursor');
  return id;
}

export function cacheRequest(origin: string, path: string, query: string): Request {
  return new Request(`${origin}/api/v1${path}?${query}`);
}

export async function readCache(request: Request): Promise<unknown | undefined> {
  try {
    const cache = (caches as CacheStorage & { default?: Cache }).default;
    const hit = await cache?.match(request);
    if (hit) return await hit.json();
  } catch { /* Cache is optional in local dev. */ }
  return undefined;
}

export async function writeCache(request: Request, value: unknown): Promise<void> {
  try {
    const cache = (caches as CacheStorage & { default?: Cache }).default;
    await cache?.put(request, Response.json(value, { headers: { 'Cache-Control': 'public, max-age=86400' } }));
  } catch { /* A cache write must not fail the response. */ }
}

export async function upstream(url: string, params: Record<string, string>, timeout = 8000): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (error) {
    console.error('upstream fetch failed', new URL(url).host, error instanceof Error ? error.name : 'error');
    throw new V1Error(502, 'upstream_unavailable', 'Upstream service unavailable');
  }
  if (!response.ok) {
    console.error('upstream status', new URL(url).host, response.status);
    throw new V1Error(502, 'upstream_unavailable', 'Upstream service unavailable');
  }
  try {
    const data = await response.json() as { error?: unknown };
    if (!data || typeof data !== 'object' || data.error) {
      console.error('upstream payload', new URL(url).host, data && typeof data === 'object' ? Object.keys(data).slice(0, 6).join(',') : typeof data);
      throw new Error('upstream');
    }
    return data;
  } catch (error) {
    if (error instanceof V1Error) throw error;
    throw new V1Error(502, 'upstream_unavailable', 'Upstream service unavailable');
  }
}

export function bearer(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const token = /^Bearer (.+)$/.exec(header)?.[1] ?? '';
  if (!KEY_RE.test(token)) throw new V1Error(401, 'unauthorized', 'Invalid API key');
  return token;
}

export async function readJson(request: Request, cap: number): Promise<unknown> {
  if (!request.headers.get('content-type')?.match(/^application\/json(?:\s*;|$)/i)) throw new V1Error(400, 'invalid_request', 'JSON required');
  if (Number(request.headers.get('content-length')) > cap) throw new V1Error(400, 'invalid_request', 'Request too large');
  const reader = request.body?.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  if (reader) while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > cap) { await reader.cancel(); throw new V1Error(400, 'invalid_request', 'Request too large'); }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown; } catch { throw new V1Error(400, 'invalid_request', 'Invalid JSON'); }
}
