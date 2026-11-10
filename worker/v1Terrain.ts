import { ELEVATION_ROOT } from '../src/map/apiSources';
import { pathLength, roundCoord, FT_PER_M } from '../src/map/geo';
import { gridStats, hornSlopeAspect, metresPerDegree, move, resampleLine, round1 } from '../src/map/terrainMath';
import type { LngLat } from '../src/types';
import { actor, bboxCovered, cacheRequest, limitBinding, lineStringCoords, num, parseBbox, parseLatLng, parsePath, readCache, requireCoverage, upstream, V1Error, writeCache, type V1Ctx } from './v1Shared';

const SOURCE = { source: 'USGS 3DEP', license: 'public domain' };

function elevation(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw === 'string' && raw.toLowerCase() === 'nodata') return null;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= -100 && n <= 9000 ? n : null;
}

async function getSamples(points: LngLat[]): Promise<(number | null)[]> {
  const data = await upstream(`${ELEVATION_ROOT}/getSamples`, {
    f: 'json', geometryType: 'esriGeometryMultipoint', returnFirstValueOnly: 'true',
    geometry: JSON.stringify({ points, spatialReference: { wkid: 4326 } }),
  }, 12_000) as { samples?: { locationId?: number; value?: unknown }[] };
  if (!Array.isArray(data.samples)) throw new V1Error(502, 'upstream_unavailable', 'Elevation service unavailable');
  const values = points.map(() => null as number | null);
  data.samples.forEach((sample, index) => {
    const at = Number.isInteger(sample.locationId) ? sample.locationId! : index;
    if (at >= 0 && at < values.length) values[at] = elevation(sample.value);
  });
  return values;
}

async function cached(ctx: V1Ctx, path: string, query: string, load: () => Promise<unknown>): Promise<unknown> {
  const request = cacheRequest(ctx.url.origin, path, query);
  const hit = await readCache(request);
  if (hit !== undefined) return hit;
  await limitBinding(ctx.env.RL_UPSTREAM, actor(ctx));
  const value = await load();
  await writeCache(request, value);
  return value;
}

export async function terrainPoint(ctx: V1Ctx): Promise<unknown> {
  const { lat, lng } = parseLatLng(ctx.search);
  requireCoverage(lng, lat);
  return cached(ctx, '/terrain/point', `lat=${lat}&lng=${lng}`, async () => {
    const spacing = 10;
    const points: LngLat[] = [];
    for (const north of [spacing, 0, -spacing]) for (const east of [-spacing, 0, spacing]) points.push(move(lng, lat, east, north));
    const values = await getSamples(points);
    const center = values[4];
    if (center == null) throw new V1Error(404, 'no_data', 'No elevation data');
    const slope = values.every(v => v != null) ? hornSlopeAspect(values as number[], spacing) : null;
    return {
      location: roundCoord([lng, lat]), elevation_m: round1(center), elevation_ft: Math.round(center * FT_PER_M),
      slope_deg: slope?.slope_deg ?? null, slope_pct: slope?.slope_pct ?? null, aspect_deg: slope?.aspect_deg ?? null, aspect: slope?.aspect ?? null,
      cell_size_m: spacing, ...SOURCE,
    };
  });
}

function samplesParam(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const n = num(value);
  if (n == null || !Number.isInteger(n) || n < 2 || n > 256) throw new V1Error(400, 'invalid_request', 'Invalid samples');
  return n;
}

function profileCoords(ctx: V1Ctx): { coords: LngLat[]; requested?: number } {
  const body = ctx.body as { geometry?: unknown; samples?: unknown } | null;
  if (body && typeof body === 'object' && body.geometry) return { coords: lineStringCoords(body.geometry), requested: samplesParam(body.samples) };
  return { coords: parsePath(ctx.search.get('path')), requested: samplesParam(ctx.search.get('samples')) };
}

export async function terrainProfile(ctx: V1Ctx): Promise<unknown> {
  const { coords, requested } = profileCoords(ctx);
  if (coords.length < 2 || coords.length > 500) throw new V1Error(400, 'invalid_request', 'Invalid path');
  for (const point of coords) requireCoverage(point[0], point[1]);
  const length = pathLength(coords);
  if (length > 100_000) throw new V1Error(400, 'invalid_request', 'Path is too long');
  const samples = requested ?? Math.min(256, Math.max(2, Math.ceil(length / 30)));
  const key = `path=${coords.map(point => point.join(',')).join(';')}&samples=${samples}`;
  return cached(ctx, '/terrain/profile', key, async () => {
    const along = resampleLine(coords, samples);
    const values = await getSamples(along.map(point => [point.lng, point.lat]));
    if (values.every(value => value == null)) throw new V1Error(404, 'no_data', 'No elevation data');
    let gain = 0, loss = 0, min = Infinity, max = -Infinity;
    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      if (value != null) { min = Math.min(min, value); max = Math.max(max, value); }
      const previous = values[i - 1];
      if (value == null || previous == null) continue;
      if (value > previous) gain += value - previous;
      else loss += previous - value;
    }
    return {
      distance_m: Math.round(length), min_m: round1(min), max_m: round1(max), gain_m: Math.round(gain), loss_m: Math.round(loss),
      samples: along.map((point, index) => ({ d: Math.round(point.d), lng: point.lng, lat: point.lat, elevation_m: values[index] == null ? null : round1(values[index]!) })),
      ...SOURCE,
    };
  });
}

export async function terrainSummary(ctx: V1Ctx): Promise<unknown> {
  const box = parseBbox(ctx.search.get('bbox'), 0.25);
  bboxCovered(box);
  const [west, south, east, north] = box;
  return cached(ctx, '/terrain/summary', `bbox=${box.join(',')}`, async () => {
    const cols = 16, rows = 16;
    const points: LngLat[] = [];
    for (let row = 0; row < rows; row++) {
      const lat = north - (north - south) * row / (rows - 1);
      for (let col = 0; col < cols; col++) points.push(roundCoord([west + (east - west) * col / (cols - 1), lat]));
    }
    const values = await getSamples(points);
    const midLat = (south + north) / 2;
    const dy = (north - south) / (rows - 1) * metresPerDegree;
    const dx = (east - west) / (cols - 1) * metresPerDegree * Math.max(0.01, Math.cos(midLat * Math.PI / 180));
    const stats = gridStats(values, points, cols, rows, dx, dy);
    if (!stats) throw new V1Error(404, 'no_data', 'No elevation data');
    return { bbox: box, grid: [cols, rows], cell_size_m: dy >= 10 ? Math.round(dy) : round1(dy), ...stats, ...SOURCE };
  });
}
