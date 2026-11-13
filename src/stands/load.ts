import { fromArrayBuffer } from 'geotiff';
import type { MultiPolygon, Polygon, Position } from 'geojson';
import { haversine } from '../map/geo';
import { publicLandWhere, PUBLIC_LANDS, type PublicLandId } from '../map/publicLands';
import { areaSources } from '../map/rules/registry';
import '../map/rules/wisconsin';
import { LIDAR_DEM_ROOT, PADUS_QUERY } from '../map/sources';
import type { LngLat } from '../types';

/** [west, south, east, north] */
export type BBox = [number, number, number, number];

const MAX_M = 4000;
const MERCATOR_R = 6378137;
const MERCATOR_MAX = Math.PI * MERCATOR_R;

const NLCD = 'https://dmsdata.cr.usgs.gov/geoserver/mrlc_Land-Cover-Native_conus_year_data/wms';
const NLCD_LAYER = 'Land-Cover-Native_conus_year_data';

/** NLCD class colors from the land-cover legend. */
const NLCD_COLORS: readonly [number, number, number, number][] = [
  [11, 0x46, 0x6b, 0x9f],
  [12, 0xd1, 0xde, 0xf8],
  [21, 0xde, 0xc5, 0xc5],
  [22, 0xd9, 0x92, 0x82],
  [23, 0xeb, 0x00, 0x00],
  [24, 0xab, 0x00, 0x00],
  [31, 0xb3, 0xac, 0x9f],
  [41, 0x68, 0xab, 0x5f],
  [42, 0x1c, 0x5f, 0x2c],
  [43, 0xb5, 0xc5, 0x8f],
  [52, 0xcc, 0xb8, 0x79],
  [71, 0xdf, 0xdf, 0xc2],
  [81, 0xdc, 0xd9, 0x39],
  [82, 0xab, 0x6c, 0x28],
  [90, 0xb8, 0xd9, 0xeb],
  [95, 0x6c, 0x9f, 0xb8],
];

export class StandSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StandSearchError';
  }
}

export interface Ground {
  cols: number;
  rows: number;
  cellM: number;
  /** North-up elevation, metres. NaN where 3DEP has no ground. */
  z: Float32Array;
  slope: Float32Array;
  /** Downhill bearing, degrees. NaN on flat ground. */
  aspect: Float32Array;
  /** NLCD class, or 0 when cover was unavailable. */
  cover: Uint8Array;
  /** 0 outside known public land, 1 huntable, 2 no-entry. */
  land: Uint8Array;
  box: BBox;
  lngOf(col: number): number;
  latOf(row: number): number;
}

export function limitBox(box: BBox): BBox | null {
  let [west, south, east, north] = box;
  if (![west, south, east, north].every(Number.isFinite)) return null;
  if (west > east) [west, east] = [east, west];
  if (south > north) [south, north] = [north, south];
  const midLat = (south + north) / 2;
  const cos = Math.max(0.2, Math.cos(midLat * Math.PI / 180));
  const widthM = (east - west) * 111_320 * cos;
  const heightM = (north - south) * 111_320;
  if (widthM < 120 || heightM < 120) return null;
  const cx = (west + east) / 2;
  const cy = (south + north) / 2;
  if (widthM > MAX_M) {
    const d = MAX_M / 2 / (111_320 * cos);
    west = cx - d;
    east = cx + d;
  }
  if (heightM > MAX_M) {
    const d = MAX_M / 2 / 111_320;
    south = cy - d;
    north = cy + d;
  }
  return [west, south, east, north];
}

function mercator(lng: number, lat: number): [number, number] {
  const x = lng * MERCATOR_MAX / 180;
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const y = Math.log(Math.tan(Math.PI / 4 + clamped * Math.PI / 360)) * MERCATOR_R;
  return [x, y];
}

function unmercator(x: number, y: number): LngLat {
  const lng = x * 180 / MERCATOR_MAX;
  const lat = Math.atan(Math.sinh(y / MERCATOR_R)) * 180 / Math.PI;
  return [lng, lat];
}

function gridSize(box: BBox): { cols: number; rows: number } {
  const [west, south, east, north] = box;
  const midLat = (south + north) / 2;
  const cos = Math.max(0.2, Math.cos(midLat * Math.PI / 180));
  const widthM = (east - west) * 111_320 * cos;
  const heightM = (north - south) * 111_320;
  const span = Math.max(widthM, heightM, 1);
  const cells = Math.max(28, Math.min(96, Math.round(span / 36)));
  const step = span / cells;
  return {
    cols: Math.max(24, Math.min(96, Math.round(widthM / step))),
    rows: Math.max(24, Math.min(96, Math.round(heightM / step))),
  };
}

function usable(value: number, nodata: number | null): boolean {
  return Number.isFinite(value) && value > -100 && value < 9000 && value !== nodata;
}

function fillSmallHoles(z: Float32Array, cols: number, rows: number): void {
  const deltas = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
  for (let pass = 0; pass < 4; pass++) {
    const next = z.slice();
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const index = row * cols + col;
      if (Number.isFinite(z[index]!)) continue;
      let sum = 0;
      let count = 0;
      for (const [dr, dc] of deltas) {
        const r = row + dr;
        const c = col + dc;
        if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
        const value = z[r * cols + c]!;
        if (Number.isFinite(value)) { sum += value; count++; }
      }
      if (count >= 3) next[index] = sum / count;
    }
    z.set(next);
  }
}

async function loadElevation(box: BBox, cols: number, rows: number, signal: AbortSignal): Promise<{ z: Float32Array; lng: Float64Array; lat: Float64Array; cellM: number; dx: number; dy: number }> {
  const [west, south, east, north] = box;
  const [minX, minY] = mercator(west, south);
  const [maxX, maxY] = mercator(east, north);
  const params = new URLSearchParams({
    bbox: `${minX},${minY},${maxX},${maxY}`,
    bboxSR: '3857',
    imageSR: '3857',
    size: `${cols},${rows}`,
    format: 'tiff',
    pixelType: 'F32',
    interpolation: 'RSP_BilinearInterpolation',
    f: 'image',
  });
  let response: Response;
  try {
    response = await fetch(`${LIDAR_DEM_ROOT}?${params}`, { signal });
  } catch (err) {
    if (signal.aborted) throw err;
    throw new StandSearchError('Elevation unavailable');
  }
  if (!response.ok) throw new StandSearchError('Elevation unavailable');
  try {
    const tiff = await fromArrayBuffer(await response.arrayBuffer());
    const image = await tiff.getImage();
    if (image.getSamplesPerPixel() !== 1) throw new StandSearchError('Elevation unavailable');
    const width = image.getWidth();
    const height = image.getHeight();
    const raster = await image.readRasters({ interleave: true });
    const raw = raster instanceof Float32Array ? raster : Float32Array.from(raster as ArrayLike<number>);
    if (raw.length !== width * height || width < 8 || height < 8) throw new StandSearchError('Elevation unavailable');
    const nodata = image.getGDALNoData();
    let valid = 0;
    for (const value of raw) if (usable(value, nodata)) valid++;
    if (valid < raw.length * 0.45) throw new StandSearchError('No elevation');
    const resolution = image.getResolution();
    const northUp = resolution[1]! <= 0;
    const z = new Float32Array(width * height);
    for (let row = 0; row < height; row++) {
      const src = northUp ? row : height - 1 - row;
      for (let col = 0; col < width; col++) {
        const value = raw[src * width + col]!;
        z[row * width + col] = usable(value, nodata) ? value : Number.NaN;
      }
    }
    fillSmallHoles(z, width, height);
    const lng = new Float64Array(width);
    const lat = new Float64Array(height);
    for (let col = 0; col < width; col++) lng[col] = unmercator(minX + (col + 0.5) * (maxX - minX) / width, minY)[0];
    for (let row = 0; row < height; row++) lat[row] = unmercator(minX, maxY - (row + 0.5) * (maxY - minY) / height)[1];
    const mid = Math.floor(height / 2);
    const dx = Math.max(20, haversine([lng[0]!, lat[mid]!], [lng[Math.min(1, width - 1)]!, lat[mid]!]));
    const dy = Math.max(20, haversine([lng[0]!, lat[0]!], [lng[0]!, lat[Math.min(1, height - 1)]!]));
    return { z, lng, lat, cellM: (dx + dy) / 2, dx, dy };
  } catch (err) {
    if (err instanceof StandSearchError || signal.aborted) throw err;
    throw new StandSearchError('Elevation unavailable');
  }
}

function nearestCover(r: number, g: number, b: number): number {
  let best = 0;
  let dist = 70 * 70;
  for (const [code, cr, cg, cb] of NLCD_COLORS) {
    const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (d < dist) { dist = d; best = code; }
  }
  return best;
}

async function loadCover(box: BBox, cols: number, rows: number, signal: AbortSignal): Promise<Uint8Array> {
  const cover = new Uint8Array(cols * rows);
  const [west, south, east, north] = box;
  const [minX, minY] = mercator(west, south);
  const [maxX, maxY] = mercator(east, north);
  const params = new URLSearchParams({
    service: 'WMS',
    version: '1.1.1',
    request: 'GetMap',
    layers: NLCD_LAYER,
    styles: '',
    srs: 'EPSG:3857',
    bbox: `${minX},${minY},${maxX},${maxY}`,
    width: String(cols),
    height: String(rows),
    format: 'image/png',
    transparent: 'true',
    time: '2025-01-01',
  });
  try {
    const response = await fetch(`${NLCD}?${params}`, { signal });
    if (!response.ok) return cover;
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return cover;
    ctx.drawImage(bitmap, 0, 0);
    const pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    bitmap.close();
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const x = Math.min(bitmap.width - 1, Math.floor((col + 0.5) * bitmap.width / cols));
      const y = Math.min(bitmap.height - 1, Math.floor((row + 0.5) * bitmap.height / rows));
      const i = (y * bitmap.width + x) * 4;
      if (pixels[i + 3]! < 128) continue;
      cover[row * cols + col] = nearestCover(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!);
    }
  } catch (err) {
    if (signal.aborted) throw err;
  }
  return cover;
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function categoryOf(name: string, type: string, designation: string): PublicLandId | null {
  if (name === 'USFS') return 'usfs';
  if (name === 'BLM') return 'blm';
  if (name === 'NPS') return 'nps';
  if (name === 'FWS') return 'fws';
  if (type === 'STAT' && (designation === 'SP' || name === 'SPR')) return 'statePark';
  if (type === 'STAT' && (name === 'SFW' || (name === 'SDNR' && designation !== 'SP'))) return 'stateWildlife';
  if (name === 'SLB') return 'stateTrust';
  if (name === 'DOD') return 'dod';
  if (type === 'LOC' || type === 'DIST' || type === 'JNT' || type === 'FED' || type === 'STAT') return 'other';
  return null;
}

type Ring = [number, number][];

function clipRing(ring: Ring, box: BBox): Ring {
  const [west, south, east, north] = box;
  const inside = [
    (p: [number, number]) => p[0] >= west,
    (p: [number, number]) => p[0] <= east,
    (p: [number, number]) => p[1] >= south,
    (p: [number, number]) => p[1] <= north,
  ];
  const cross = [
    (a: [number, number], b: [number, number]): [number, number] => {
      const t = (west - a[0]) / (b[0] - a[0] || Number.NaN);
      return [west, a[1] + t * (b[1] - a[1])];
    },
    (a: [number, number], b: [number, number]): [number, number] => {
      const t = (east - a[0]) / (b[0] - a[0] || Number.NaN);
      return [east, a[1] + t * (b[1] - a[1])];
    },
    (a: [number, number], b: [number, number]): [number, number] => {
      const t = (south - a[1]) / (b[1] - a[1] || Number.NaN);
      return [a[0] + t * (b[0] - a[0]), south];
    },
    (a: [number, number], b: [number, number]): [number, number] => {
      const t = (north - a[1]) / (b[1] - a[1] || Number.NaN);
      return [a[0] + t * (b[0] - a[0]), north];
    },
  ];
  let output = ring;
  for (let edge = 0; edge < 4; edge++) {
    if (output.length < 3) return [];
    const input = output;
    output = [];
    let prev = input[input.length - 1]!;
    const contains = inside[edge]!;
    const cut = cross[edge]!;
    for (const cur of input) {
      const curIn = contains(cur);
      const prevIn = contains(prev);
      if (curIn) {
        if (!prevIn) output.push(cut(prev, cur));
        output.push(cur);
      } else if (prevIn) output.push(cut(prev, cur));
      prev = cur;
    }
    output = output.filter(point => Number.isFinite(point[0]) && Number.isFinite(point[1]));
  }
  return output.length >= 3 ? output : [];
}

function insideRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if ((a[1] > lat) !== (b[1] > lat) && lng < ((b[0] - a[0]) * (lat - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

interface Poly { land: 1 | 2; rings: Ring[] }

function asRings(geometry: { rings?: unknown } | null | undefined, box: BBox): Ring[] {
  if (!geometry || !Array.isArray(geometry.rings)) return [];
  const pad: BBox = [box[0] - 0.01, box[1] - 0.01, box[2] + 0.01, box[3] + 0.01];
  const rings: Ring[] = [];
  for (const raw of geometry.rings) {
    if (!Array.isArray(raw)) continue;
    const ring: Ring = [];
    for (const point of raw) {
      if (!Array.isArray(point) || point.length < 2) continue;
      const x = Number(point[0]);
      const y = Number(point[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      ring.push(Math.abs(x) > 180 ? unmercator(x, y) : [x, y]);
    }
    const clipped = clipRing(ring, pad);
    if (clipped.length >= 3) rings.push(clipped);
  }
  return rings;
}

const CLOSED_KINDS = new Set(['entry', 'closed', 'municipal']);

function clippedRing(ring: Position[], box: BBox): Ring {
  const points: Ring = [];
  for (const point of ring) {
    const x = Number(point[0]);
    const y = Number(point[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) points.push([x, y]);
  }
  return clipRing(points, box);
}

function polygonContains(lng: number, lat: number, rings: Ring[]): boolean {
  let hits = 0;
  for (const ring of rings) if (insideRing(lng, lat, ring)) hits++;
  return hits % 2 === 1;
}

/** Closed, restricted, and municipal no-hunt areas become no-go cells. */
async function markClosures(
  box: BBox,
  land: Uint8Array,
  cols: number,
  rows: number,
  lngOf: (col: number) => number,
  latOf: (row: number) => number,
  signal: AbortSignal,
): Promise<void> {
  const pad: BBox = [box[0] - 0.01, box[1] - 0.01, box[2] + 0.01, box[3] + 0.01];
  const areas: Ring[][] = [];
  for (const source of areaSources) {
    let features: { geometry: Polygon | MultiPolygon; properties?: { kind?: unknown } | null }[];
    try {
      features = await source.load(box[0], box[1], box[2], box[3], 14, signal);
    } catch (err) {
      if (signal.aborted) throw err;
      throw new StandSearchError('Rules unavailable');
    }
    for (const feature of features) {
      const kind = feature.properties && typeof feature.properties.kind === 'string' ? feature.properties.kind : '';
      if (!CLOSED_KINDS.has(kind)) continue;
      const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
      for (const polygon of polygons) {
        const rings = polygon.map(ring => clippedRing(ring, pad)).filter(part => part.length >= 3);
        if (rings.length) areas.push(rings);
      }
    }
  }
  if (!areas.length) return;
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const lng = lngOf(col);
    const lat = latOf(row);
    for (const rings of areas) {
      if (!polygonContains(lng, lat, rings)) continue;
      land[row * cols + col] = 2;
      break;
    }
  }
}

async function loadLand(box: BBox, cols: number, rows: number, lngOf: (col: number) => number, latOf: (row: number) => number, signal: AbortSignal): Promise<Uint8Array> {
  const land = new Uint8Array(cols * rows);
  const where = publicLandWhere(PUBLIC_LANDS.map(item => item.id));
  const polys: Poly[] = [];
  try {
    for (let offset = 0; offset < 400; offset += 200) {
      const params = new URLSearchParams({
        f: 'json',
        geometry: box.join(','),
        geometryType: 'esriGeometryEnvelope',
        inSR: '4326',
        outSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        where,
        outFields: 'Mang_Name,Mang_Type,Des_Tp,Pub_Access',
        returnGeometry: 'true',
        geometryPrecision: '5',
        maxAllowableOffset: '0.00045',
        resultOffset: String(offset),
        resultRecordCount: '200',
      });
      const response = await fetch(`${PADUS_QUERY}?${params}`, { signal });
      if (!response.ok) throw new StandSearchError('Public land unavailable');
      const data = await response.json() as {
        error?: unknown;
        exceededTransferLimit?: boolean;
        features?: { attributes?: Record<string, unknown>; geometry?: { rings?: unknown } }[];
      };
      if (data.error || !Array.isArray(data.features)) throw new StandSearchError('Public land unavailable');
      for (const feature of data.features) {
        const attrs = feature.attributes ?? {};
        const name = text(attrs.Mang_Name).toUpperCase();
        const type = text(attrs.Mang_Type).toUpperCase();
        const designation = text(attrs.Des_Tp).toUpperCase();
        const category = categoryOf(name, type, designation);
        if (!category) continue;
        const rings = asRings(feature.geometry, box);
        if (!rings.length) continue;
        const access = text(attrs.Pub_Access).toUpperCase();
        const closed = access === 'XA' || category === 'nps' || category === 'dod';
        polys.push({ land: closed ? 2 : 1, rings });
      }
      if (!data.exceededTransferLimit) break;
    }
  } catch (err) {
    if (err instanceof StandSearchError || signal.aborted) throw err;
    throw new StandSearchError('Public land unavailable');
  }
  if (!polys.length) throw new StandSearchError('No public land');
  let open = 0;
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const lng = lngOf(col);
    const lat = latOf(row);
    let kind: 0 | 1 | 2 = 0;
    for (const poly of polys) {
      let hits = 0;
      for (const ring of poly.rings) if (insideRing(lng, lat, ring)) hits++;
      if (hits % 2 === 0) continue;
      if (poly.land === 2) { kind = 2; break; }
      kind = 1;
    }
    land[row * cols + col] = kind;
    if (kind === 1) open++;
  }
  await markClosures(box, land, cols, rows, lngOf, latOf, signal);
  open = 0;
  for (const kind of land) if (kind === 1) open++;
  if (!open) throw new StandSearchError('No public land');
  return land;
}

function slopeAspect(z: Float32Array, cols: number, rows: number, dx: number, dy: number): { slope: Float32Array; aspect: Float32Array } {
  const slope = new Float32Array(z.length);
  const aspect = new Float32Array(z.length);
  aspect.fill(Number.NaN);
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const index = row * cols + col;
    const z0 = z[index]!;
    if (!Number.isFinite(z0)) { slope[index] = Number.NaN; continue; }
    const west = col > 0 ? z[index - 1]! : Number.NaN;
    const east = col < cols - 1 ? z[index + 1]! : Number.NaN;
    const north = row > 0 ? z[index - cols]! : Number.NaN;
    const south = row < rows - 1 ? z[index + cols]! : Number.NaN;
    const dzdx = Number.isFinite(west) && Number.isFinite(east) ? (east - west) / (2 * dx)
      : Number.isFinite(east) ? (east - z0) / dx
        : Number.isFinite(west) ? (z0 - west) / dx : Number.NaN;
    const dzdy = Number.isFinite(north) && Number.isFinite(south) ? (north - south) / (2 * dy)
      : Number.isFinite(south) ? (z0 - south) / dy
        : Number.isFinite(north) ? (north - z0) / dy : Number.NaN;
    if (!Number.isFinite(dzdx) || !Number.isFinite(dzdy)) { slope[index] = Number.NaN; continue; }
    const deg = Math.atan(Math.hypot(dzdx, dzdy)) * 180 / Math.PI;
    slope[index] = deg;
    if (deg >= 0.5) aspect[index] = (Math.atan2(-dzdx, -dzdy) * 180 / Math.PI + 360) % 360;
  }
  return { slope, aspect };
}

/** 3DEP elevation, Annual NLCD, and PAD-US for one search box. */
export async function loadGround(box: BBox, signal: AbortSignal): Promise<Ground> {
  const { cols, rows } = gridSize(box);
  const elevation = await loadElevation(box, cols, rows, signal);
  const width = elevation.lng.length;
  const height = elevation.lat.length;
  const [cover, land] = await Promise.all([
    loadCover(box, width, height, signal),
    loadLand(box, width, height, col => elevation.lng[col]!, row => elevation.lat[row]!, signal),
  ]);
  const { slope, aspect } = slopeAspect(elevation.z, width, height, elevation.dx, elevation.dy);
  return {
    cols: width,
    rows: height,
    cellM: elevation.cellM,
    z: elevation.z,
    slope,
    aspect,
    cover,
    land,
    box,
    lngOf: col => elevation.lng[col]!,
    latOf: row => elevation.lat[row]!,
  };
}
