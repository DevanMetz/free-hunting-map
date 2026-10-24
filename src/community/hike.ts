import { haversine, pathLength, roundCoord } from '../map/geo';
import { bbox, simplify, tiles, inSupportedUS, type Point } from './geometry';
export const HIKE_TYPES = ['hike', 'scouting', 'deer drag', 'ATV', 'horse', 'other'] as const;
export const HIKE_REPORT_THRESHOLD = 3;
export interface Hike { month: string; name: string; type: typeof HIKE_TYPES[number] | null; coordinates: Point[]; distance: number }
export interface WireHike { v: 1; month: string; name: string; type: Hike['type']; d: number[] }
export const publicName = (value: string) => value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, 60);
/** Zero shares the full line; otherwise interpolate exact along-track cuts. Always copy only longitude/latitude. */
export function trimHike(coords: Point[], trim = 200): Point[] {
  if (trim === 0) return simplify(coords.map(p => roundCoord([p[0], p[1]])), 2.5);
  if (!Number.isFinite(trim) || trim < 100 || trim > 500) return [];
  const total = pathLength(coords);
  if (total - 2 * trim <= 200) return [];
  const result: Point[] = [];
  let at = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]!, b = coords[i]!, length = haversine(a, b), end = at + length;
    if (length && end >= trim && at <= total - trim) {
      const point = (t: number): Point => roundCoord([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      if (!result.length) result.push(point(Math.max(0, (trim - at) / length)));
      result.push(point(Math.min(1, (total - trim - at) / length)));
    }
    at = end;
    if (at >= total - trim) break;
  }
  return simplify(result, 2.5);
}
export function encodeHike(coordinates: Point[], month: string, name = '', type: Hike['type'] = null): WireHike {
  let x = 0, y = 0;
  const d: number[] = [];
  for (const p of coordinates) { const xx = Math.round(p[0] * 1e6), yy = Math.round(p[1] * 1e6); d.push(xx - x, yy - y); x = xx; y = yy; }
  return { v: 1, month, name: publicName(name), type, d };
}
export function decodeHike(raw: unknown, now = Date.now()): Hike {
  const fail = (): never => { throw new Error('Invalid community hike'); };
  if (!raw || typeof raw !== 'object') return fail();
  const r = raw as WireHike;
  if (Object.keys(r).some(k => !['v','month','name','type','d'].includes(k)) || r.v !== 1 || typeof r.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(r.month) || r.month < '2000-01' || r.month > new Date(now).toISOString().slice(0,7)
    || typeof r.name !== 'string' || r.name.length > 60 || r.name !== publicName(r.name) || !(r.type === null || HIKE_TYPES.includes(r.type))
    || !Array.isArray(r.d) || r.d.length < 4 || r.d.length > 20000 || r.d.length % 2 || !r.d.every(Number.isSafeInteger)) return fail();
  let x = 0, y = 0;
  const coordinates: Point[] = [];
  for (let i=0;i<r.d.length;i+=2) { x+=r.d[i]!; y+=r.d[i+1]!; const p:Point=[x/1e6,y/1e6]; if (!inSupportedUS(p)) return fail(); coordinates.push(p); }
  const b = bbox(coordinates), distance = pathLength(coordinates);
  if (distance <= 200 || distance > 100000 || b[2]-b[0] > 1 || b[3]-b[1] > 1 || (b[2]-b[0])*(b[3]-b[1]) > .1 || tiles(b).length > 400) return fail();
  return { month:r.month, name:r.name, type:r.type, coordinates, distance:Math.round(distance) };
}
export const validHikeId = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export const randomHikeToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), n=>n.toString(16).padStart(2,'0')).join('');
