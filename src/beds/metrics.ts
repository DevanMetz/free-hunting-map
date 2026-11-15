import { aspectMatches, type BedProfile, type TerrainKind } from './profile';

export interface Metrics {
  cols: number;
  rows: number;
  dx: number;
  dy: number;
  z: Float32Array;
  slope: Float32Array;
  /** Downhill compass bearing. NaN on flat ground. */
  aspect: Float32Array;
  /** 0 at the downhill pool, 100 at the uphill peak. NaN when the path has no relief. */
  position: Float32Array;
  /** Yokoyama positive openness, degrees. ~90 on flat ground. */
  openness: Float32Array;
  /** Rise and fall within 25 m, as degrees over that distance. */
  steepness: Float32Array;
}

export interface Acreage {
  total: number;
  aspect: number;
  position: number;
  openness: number;
  steep: number;
  cellM2: number;
}

const DR8 = [-1, -1, 0, 1, 1, 1, 0, -1];
const DC8 = [0, 1, 1, 1, 0, -1, -1, -1];

/**
 * Terrain metrics for one north-up elevation grid.
 * Relative slope position follows the downhill D8 path to a pool and the
 * steepest ascent to a peak, then places the cell by elevation between them.
 * Positive openness is the 8-direction, 15 m Yokoyama mean, the same radius
 * the lidar openness tiles use. Steepness is the elevation range inside 25 m.
 */
export function computeMetrics(z: Float32Array, cols: number, rows: number, dx: number, dy: number): Metrics {
  const work = z.slice();
  fillHoles(work, cols, rows);
  const { slope, aspect } = slopeAspect(work, cols, rows, dx, dy);
  fillPits(work, cols, rows);
  const position = flowPosition(work, cols, rows, dx, dy);
  return {
    cols, rows, dx, dy, z: work, slope, aspect, position,
    openness: positiveOpenness(work, cols, rows, dx, dy),
    steepness: reliefSteepness(work, cols, rows, dx, dy),
  };
}

export function maskOf(metrics: Metrics, profile: BedProfile, mode: 'all' | 'hillside'): Uint8Array {
  const out = new Uint8Array(metrics.z.length);
  const [p0, p1] = profile.position;
  const [o0, o1] = profile.openness;
  const [s0, s1] = profile.steepness;
  for (let i = 0; i < metrics.z.length; i++) {
    if (!Number.isFinite(metrics.z[i]!)) continue;
    if (!aspectMatches(metrics.aspect[i]!, profile.aspectStart, profile.aspectEnd)) continue;
    const position = metrics.position[i]!;
    if (!Number.isFinite(position) || position < p0 || position > p1) continue;
    if (mode === 'hillside') { out[i] = 1; continue; }
    const openness = metrics.openness[i]!;
    const steep = metrics.steepness[i]!;
    if (!Number.isFinite(openness) || openness < o0 || openness > o1) continue;
    if (!Number.isFinite(steep) || steep < s0 || steep > s1) continue;
    out[i] = 1;
  }
  return out;
}

export function acreage(metrics: Metrics, profile: BedProfile): Acreage {
  const counts: Acreage = { total: 0, aspect: 0, position: 0, openness: 0, steep: 0, cellM2: metrics.dx * metrics.dy };
  const [p0, p1] = profile.position;
  const [o0, o1] = profile.openness;
  const [s0, s1] = profile.steepness;
  for (let i = 0; i < metrics.z.length; i++) {
    if (!Number.isFinite(metrics.z[i]!)) continue;
    counts.total++;
    if (!aspectMatches(metrics.aspect[i]!, profile.aspectStart, profile.aspectEnd)) continue;
    counts.aspect++;
    const position = metrics.position[i]!;
    if (!Number.isFinite(position) || position < p0 || position > p1) continue;
    counts.position++;
    const openness = metrics.openness[i]!;
    if (!Number.isFinite(openness) || openness < o0 || openness > o1) continue;
    counts.openness++;
    const steep = metrics.steepness[i]!;
    if (!Number.isFinite(steep) || steep < s0 || steep > s1) continue;
    counts.steep++;
  }
  return counts;
}

export function suggestTerrain(metrics: Metrics): TerrainKind {
  const heights: number[] = [];
  const slopes: number[] = [];
  for (let i = 0; i < metrics.z.length; i++) {
    if (Number.isFinite(metrics.z[i]!)) heights.push(metrics.z[i]!);
    if (Number.isFinite(metrics.slope[i]!)) slopes.push(metrics.slope[i]!);
  }
  if (heights.length < 16 || !slopes.length) return 'hill';
  heights.sort((a, b) => a - b);
  slopes.sort((a, b) => a - b);
  const relief = heights[Math.floor(heights.length * 0.95)]! - heights[Math.floor(heights.length * 0.05)]!;
  const median = slopes[Math.floor(slopes.length * 0.5)]!;
  if (relief < 18 || median < 1.8) return 'flat';
  if (relief > 380 || median > 18) return 'mountain';
  if (relief < 55 && median < 4.5) return 'farm';
  if (relief < 150 && median < 8) return 'piedmont';
  return 'hill';
}

export function sampleCell(metrics: Metrics, lng: number, lat: number, west: number, south: number, east: number, north: number): { aspect?: number; position?: number; openness?: number; steepness?: number } | null {
  const col = Math.round((lng - west) / (east - west) * metrics.cols - 0.5);
  const row = Math.round((north - lat) / (north - south) * metrics.rows - 0.5);
  if (row < 0 || col < 0 || row >= metrics.rows || col >= metrics.cols) return null;
  const index = row * metrics.cols + col;
  if (!Number.isFinite(metrics.z[index]!)) return null;
  const aspect = metrics.aspect[index]!;
  const position = metrics.position[index]!;
  const openness = metrics.openness[index]!;
  const steepness = metrics.steepness[index]!;
  return {
    ...(Number.isFinite(aspect) ? { aspect: Math.round(aspect) } : {}),
    ...(Number.isFinite(position) ? { position: Math.round(position) } : {}),
    ...(Number.isFinite(openness) ? { openness: Math.round(openness * 10) / 10 } : {}),
    ...(Number.isFinite(steepness) ? { steepness: Math.round(steepness * 10) / 10 } : {}),
  };
}

function fillHoles(z: Float32Array, cols: number, rows: number): void {
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

function fillPits(z: Float32Array, cols: number, rows: number): void {
  for (let pass = 0; pass < 2; pass++) {
    const next = z.slice();
    for (let row = 1; row < rows - 1; row++) for (let col = 1; col < cols - 1; col++) {
      const index = row * cols + col;
      const z0 = z[index]!;
      if (!Number.isFinite(z0)) continue;
      let floor = Infinity;
      let enclosed = true;
      for (let d = 0; d < 8; d++) {
        const value = z[(row + DR8[d]!) * cols + col + DC8[d]!]!;
        if (!Number.isFinite(value)) { enclosed = false; break; }
        if (value < floor) floor = value;
        if (value <= z0 + 0.05) enclosed = false;
      }
      if (enclosed && floor < 8000) next[index] = floor;
    }
    z.set(next);
  }
}

function slopeAspect(z: Float32Array, cols: number, rows: number, dx: number, dy: number): { slope: Float32Array; aspect: Float32Array } {
  const slope = new Float32Array(z.length);
  const aspect = new Float32Array(z.length);
  aspect.fill(Number.NaN);
  slope.fill(Number.NaN);
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const index = row * cols + col;
    const z0 = z[index]!;
    if (!Number.isFinite(z0)) continue;
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
    if (!Number.isFinite(dzdx) || !Number.isFinite(dzdy)) continue;
    const deg = Math.atan(Math.hypot(dzdx, dzdy)) * 180 / Math.PI;
    slope[index] = deg;
    if (deg >= 0.5) aspect[index] = (Math.atan2(-dzdx, -dzdy) * 180 / Math.PI + 360) % 360;
  }
  return { slope, aspect };
}

function flowPosition(z: Float32Array, cols: number, rows: number, dx: number, dy: number): Float32Array {
  const n = z.length;
  const down = new Int32Array(n).fill(-1);
  const up = new Int32Array(n).fill(-1);
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const index = row * cols + col;
    const z0 = z[index]!;
    if (!Number.isFinite(z0)) continue;
    let bestDrop = 0;
    let bestRise = 0;
    for (let d = 0; d < 8; d++) {
      const r = row + DR8[d]!;
      const c = col + DC8[d]!;
      if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
      const next = r * cols + c;
      const zn = z[next]!;
      if (!Number.isFinite(zn)) continue;
      const dist = Math.hypot(DR8[d]! * dy, DC8[d]! * dx) || 1;
      const drop = (z0 - zn) / dist;
      const rise = (zn - z0) / dist;
      if (drop > bestDrop) { bestDrop = drop; down[index] = next; }
      if (rise > bestRise) { bestRise = rise; up[index] = next; }
    }
  }
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const index = row * cols + col;
      if (down[index]! >= 0 || !Number.isFinite(z[index]!)) continue;
      for (let d = 0; d < 8; d++) {
        const r = row + DR8[d]!;
        const c = col + DC8[d]!;
        if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
        const next = r * cols + c;
        const zn = z[next]!;
        if (!Number.isFinite(zn) || zn > z[index]! + 0.05) continue;
        if (down[next]! >= 0 || zn < z[index]! - 0.02) { down[index] = next; changed = true; break; }
      }
    }
    if (!changed) break;
  }
  const sinkOf = new Int32Array(n).fill(-2);
  const peakOf = new Int32Array(n).fill(-2);
  const seen = new Int32Array(n);
  let stamp = 1;
  const position = new Float32Array(n);
  position.fill(Number.NaN);
  const walk = (link: Int32Array, memo: Int32Array, start: number): number => {
    const token = stamp++;
    let cur = start;
    const stack: number[] = [];
    while (memo[cur] === -2 && seen[cur] !== token) {
      seen[cur] = token;
      stack.push(cur);
      const next = link[cur]!;
      if (next < 0) break;
      cur = next;
    }
    const dest = memo[cur]! >= 0 ? memo[cur]! : cur;
    for (const cell of stack) memo[cell] = dest;
    return dest;
  };
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(z[i]!)) continue;
    const sink = walk(down, sinkOf, i);
    const peak = walk(up, peakOf, i);
    const span = z[peak]! - z[sink]!;
    if (span >= 1) position[i] = Math.max(0, Math.min(100, (z[i]! - z[sink]!) / span * 100));
  }
  return position;
}

function positiveOpenness(z: Float32Array, cols: number, rows: number, dx: number, dy: number): Float32Array {
  const out = new Float32Array(z.length);
  out.fill(Number.NaN);
  const dr = [0, 1, 1, 1, 0, -1, -1, -1];
  const dc = [1, 1, 0, -1, -1, -1, 0, 1];
  const steps = Math.min(6, Math.max(1, Math.round(15 / Math.min(dx, dy))));
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const index = row * cols + col;
    const z0 = z[index]!;
    if (!Number.isFinite(z0)) continue;
    let total = 0;
    let seen = 0;
    for (let d = 0; d < 8; d++) {
      let best = -1e30;
      let hit = false;
      for (let step = 1; step <= steps; step++) {
        const r = row + dr[d]! * step;
        const c = col + dc[d]! * step;
        if (r < 0 || c < 0 || r >= rows || c >= cols) break;
        const zn = z[r * cols + c]!;
        if (!Number.isFinite(zn)) break;
        const dist = Math.hypot(dr[d]! * step * dy, dc[d]! * step * dx);
        if (dist > 15 + Math.max(dx, dy)) break;
        const tangent = (zn - z0) / dist;
        if (tangent > best) best = tangent;
        hit = true;
      }
      if (!hit) best = 0;
      else seen++;
      total += 90 - Math.atan(best) * 180 / Math.PI;
    }
    if (seen >= 4) out[index] = total / 8;
  }
  return out;
}

function reliefSteepness(z: Float32Array, cols: number, rows: number, dx: number, dy: number): Float32Array {
  const out = new Float32Array(z.length);
  out.fill(Number.NaN);
  const radius = Math.min(5, Math.max(1, Math.ceil(25 / Math.min(dx, dy))));
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const index = row * cols + col;
    const z0 = z[index]!;
    if (!Number.isFinite(z0)) continue;
    let lo = z0;
    let hi = z0;
    let count = 0;
    for (let dr = -radius; dr <= radius; dr++) for (let dc = -radius; dc <= radius; dc++) {
      if (Math.hypot(dr * dy, dc * dx) > 25) continue;
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
      const value = z[r * cols + c]!;
      if (!Number.isFinite(value)) continue;
      if (value < lo) lo = value;
      if (value > hi) hi = value;
      count++;
    }
    if (count >= 4) out[index] = Math.atan((hi - lo) / 25) * 180 / Math.PI;
  }
  return out;
}
