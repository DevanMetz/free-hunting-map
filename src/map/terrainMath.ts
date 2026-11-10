import type { LngLat } from '../types';
import { haversine, roundCoord } from './geo';

const M_PER_DEG = 111_320;
export const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function cardinal(deg: number): (typeof CARDINALS)[number] {
  const turn = ((deg % 360) + 360) % 360;
  return CARDINALS[Math.round(turn / 45) % 8]!;
}

/** Move a WGS84 point by metres east and north. */
export function move(lng: number, lat: number, eastM: number, northM: number): LngLat {
  const dLat = northM / M_PER_DEG;
  const dLng = eastM / (M_PER_DEG * Math.max(0.01, Math.cos(lat * Math.PI / 180)));
  return [lng + dLng, lat + dLat];
}

/**
 * Horn slope on a 3×3 grid ordered north→south, west→east, spacing `s` metres.
 * Aspect is null when the slope is under 0.5°.
 */
export function hornSlopeAspect(z: readonly number[], s: number): { slope_deg: number; slope_pct: number; aspect_deg: number | null; aspect: string | null } | null {
  if (z.length !== 9 || z.some(v => !Number.isFinite(v)) || !(s > 0)) return null;
  const [a, b, c, d, , f, g, h, i] = z;
  const dzdx = ((c! + 2 * f! + i!) - (a! + 2 * d! + g!)) / (8 * s);
  const dzdy = ((a! + 2 * b! + c!) - (g! + 2 * h! + i!)) / (8 * s);
  const slope = Math.atan(Math.hypot(dzdx, dzdy));
  const slopeDeg = slope * 180 / Math.PI;
  const slopePct = Math.tan(slope) * 100;
  if (slopeDeg < 0.5) return { slope_deg: round1(slopeDeg), slope_pct: round1(slopePct), aspect_deg: null, aspect: null };
  const aspect = (Math.atan2(-dzdx, -dzdy) * 180 / Math.PI + 360) % 360;
  return { slope_deg: round1(slopeDeg), slope_pct: round1(slopePct), aspect_deg: Math.round(aspect), aspect: cardinal(aspect) };
}

export interface ProfileSample { d: number; lng: number; lat: number }

/** Equally spaced points along a line, including both endpoints. */
export function resampleLine(coords: readonly LngLat[], samples: number): ProfileSample[] {
  const count = Math.max(2, Math.floor(samples));
  const first = coords[0];
  if (!first) return [];
  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const len = haversine(coords[i - 1]!, coords[i]!);
    lengths.push(len);
    total += len;
  }
  const out: ProfileSample[] = [];
  for (let s = 0; s < count; s++) {
    const target = total * (s / (count - 1));
    let walked = 0;
    let placed = false;
    for (let i = 0; i < lengths.length; i++) {
      const len = lengths[i]!;
      if (walked + len >= target - 1e-6 || i === lengths.length - 1) {
        const t = len === 0 ? 0 : Math.min(1, Math.max(0, (target - walked) / len));
        const a = coords[i]!, b = coords[i + 1]!;
        const point = roundCoord([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        out.push({ d: target, lng: point[0], lat: point[1] });
        placed = true;
        break;
      }
      walked += len;
    }
    if (!placed) {
      const last = roundCoord(coords[coords.length - 1]!);
      out.push({ d: total, lng: last[0], lat: last[1] });
    }
  }
  return out;
}

export interface GridStat {
  elevation: { min_m: number; max_m: number; mean_m: number; relief_m: number; high_point: LngLat; low_point: LngLat };
  slope: { mean_deg: number; max_deg: number; share: Record<'0-5' | '5-15' | '15-30' | '30+', number> };
  aspect_share: Record<(typeof CARDINALS)[number], number>;
}

/** Elevation and central-difference slope for a north→south, west→east grid. */
export function gridStats(values: readonly (number | null)[], coords: readonly LngLat[], cols: number, rows: number, dx: number, dy: number): GridStat | null {
  const at = (r: number, c: number) => values[r * cols + c] ?? null;
  let count = 0, sum = 0, min = Infinity, max = -Infinity;
  let high = coords[0], low = coords[0];
  for (let i = 0; i < values.length; i++) {
    const z = values[i];
    if (z == null) continue;
    count++;
    sum += z;
    if (z < min) { min = z; low = coords[i]; }
    if (z > max) { max = z; high = coords[i]; }
  }
  if (!count || !high || !low) return null;
  const slopeBuckets = { '0-5': 0, '5-15': 0, '15-30': 0, '30+': 0 };
  const aspectBuckets: Record<(typeof CARDINALS)[number], number> = { N: 0, NE: 0, E: 0, SE: 0, S: 0, SW: 0, W: 0, NW: 0 };
  let slopeCount = 0, slopeSum = 0, slopeMax = 0, aspectCount = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const z = at(r, c);
    if (z == null || !(dx > 0) || !(dy > 0)) continue;
    const west = c > 0 ? at(r, c - 1) : null;
    const east = c < cols - 1 ? at(r, c + 1) : null;
    const north = r > 0 ? at(r - 1, c) : null;
    const south = r < rows - 1 ? at(r + 1, c) : null;
    const dzdx = west != null && east != null ? (east - west) / (2 * dx) : east != null && c === 0 ? (east - z) / dx : west != null && c === cols - 1 ? (z - west) / dx : null;
    const dzdy = north != null && south != null ? (north - south) / (2 * dy) : south != null && r === 0 ? (z - south) / dy : north != null && r === rows - 1 ? (north - z) / dy : null;
    if (dzdx == null || dzdy == null) continue;
    const slope = Math.atan(Math.hypot(dzdx, dzdy)) * 180 / Math.PI;
    slopeCount++;
    slopeSum += slope;
    slopeMax = Math.max(slopeMax, slope);
    const bucket = slope < 5 ? '0-5' : slope < 15 ? '5-15' : slope < 30 ? '15-30' : '30+';
    slopeBuckets[bucket]++;
    if (slope >= 0.5) {
      aspectCount++;
      aspectBuckets[cardinal((Math.atan2(-dzdx, -dzdy) * 180 / Math.PI + 360) % 360)]++;
    }
  }
  const portion = (n: number, total: number) => total ? Math.round(n / total * 100) / 100 : 0;
  return {
    elevation: { min_m: Math.round(min), max_m: Math.round(max), mean_m: Math.round(sum / count), relief_m: Math.round(max - min), high_point: roundCoord(high), low_point: roundCoord(low) },
    slope: {
      mean_deg: round1(slopeCount ? slopeSum / slopeCount : 0), max_deg: round1(slopeMax),
      share: { '0-5': portion(slopeBuckets['0-5'], slopeCount), '5-15': portion(slopeBuckets['5-15'], slopeCount), '15-30': portion(slopeBuckets['15-30'], slopeCount), '30+': portion(slopeBuckets['30+'], slopeCount) },
    },
    aspect_share: Object.fromEntries(CARDINALS.map(name => [name, portion(aspectBuckets[name], aspectCount)])) as GridStat['aspect_share'],
  };
}

/** Meridional metres of one degree, used to describe a summary cell. */
export const metresPerDegree = M_PER_DEG;
