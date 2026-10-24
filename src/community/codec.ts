import { bbox, tiles, simplify, type Point, type Scan, type BBox } from './geometry';
export interface WireScan {
  v: 1;
  model: string;
  day: string;
  area: BBox;
  lines: { c: number; d: number[] }[];
}
export function encode(scan: Scan): WireScan {
  return {
    v: 1, model: scan.model, day: scan.day, area: scan.area,
    lines: scan.lines.map(l => {
      let x = 0, y = 0;
      const d: number[] = [];
      for (const p of simplify(l.coordinates)) {
        const xx = Math.round(p[0] * 1e6), yy = Math.round(p[1] * 1e6);
        d.push(xx - x, yy - y); x = xx; y = yy;
      }
      return { c: l.confidence, d };
    }),
  };
}
const us = (p: Point) => [
  [-125, 24, -66, 50], [-180, 51, -129, 72], [-161, 18, -154, 23], [172, 51, 180, 72],
].some(b => p[0] >= b[0]! && p[0] <= b[2]! && p[1] >= b[1]! && p[1] <= b[3]!);
const fail = (): never => { throw new Error('Invalid community scan'); };
/** Builds a new allowlisted object; unknown input fields never enter D1 or the hash. */
export function decode(raw: unknown, now = Date.now()): Scan {
  if (!raw || typeof raw !== 'object') return fail();
  const r = raw as WireScan;
  if (r.v !== 1 || typeof r.model !== 'string' || !/^v\d+(?:[.][\w-]+)*$/.test(r.model) || r.model.length > 40
    || typeof r.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.day)) return fail();
  const date = Date.parse(r.day);
  if (!Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== r.day
    || r.day > new Date(now).toISOString().slice(0, 10) || date < now - 366 * 86400000) return fail();
  if (!Array.isArray(r.area) || r.area.length !== 4 || !r.area.every(Number.isFinite)) return fail();
  const [w, s, e, n] = r.area;
  if (w >= e || s >= n || e - w > .15 || n - s > .15 || (e - w) * (n - s) > .0025
    || !us([w, s]) || !us([e, n]) || r.area.some(v => Math.abs(v * 100 - Math.round(v * 100)) > 1e-7)) return fail();
  if (!Array.isArray(r.lines) || !r.lines.length || r.lines.length > 200) return fail();
  let count = 0, indexedTiles = 0, totalLength = 0;
  const lines = r.lines.map(l => {
    if (!l || typeof l.c !== 'number' || !Number.isFinite(l.c) || l.c < 0 || l.c > 1
      || !Array.isArray(l.d) || l.d.length < 4 || l.d.length > 4000 || l.d.length % 2 || !l.d.every(Number.isSafeInteger)) return fail();
    count += l.d.length / 2;
    if (count > 20000) return fail();
    let x = 0, y = 0;
    const coordinates: Point[] = [];
    for (let i = 0; i < l.d.length; i += 2) {
      x += l.d[i]!; y += l.d[i + 1]!;
      const p: Point = [x / 1e6, y / 1e6];
      if (!us(p) || p[0] < w - .0001 || p[0] > e + .0001 || p[1] < s - .0001 || p[1] > n + .0001) return fail();
      coordinates.push(p);
    }
    if (coordinates.every(p => p[0] === coordinates[0]![0] && p[1] === coordinates[0]![1])) return fail();
    indexedTiles += tiles(bbox(coordinates)).length;
    for (let i = 1; i < coordinates.length; i++) {
      const a = coordinates[i - 1]!, b = coordinates[i]!;
      totalLength += Math.hypot((a[0] - b[0]) * Math.cos(a[1] * Math.PI / 180), a[1] - b[1]) * 111320;
    }
    // Bound merge sampling work and D1's statements per invocation as well as JSON size.
    if (indexedTiles > 600 || totalLength > 50000) return fail();
    return { coordinates, confidence: l.c };
  });
  return { model: r.model, day: r.day, area: [w, s, e, n], lines };
}
