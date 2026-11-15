import type { Repo } from '../storage/repo';

/** Hill country follows the DeerBrain lidar study. The others are starting points. */
export const TERRAINS = ['hill', 'flat', 'farm', 'piedmont', 'mountain'] as const;
export type TerrainKind = (typeof TERRAINS)[number];

export interface BedProfile {
  terrain: TerrainKind;
  /** Kept compass arc, degrees clockwise from start to end. A full circle includes flat ground. */
  aspectStart: number;
  aspectEnd: number;
  position: [number, number];
  openness: [number, number];
  steepness: [number, number];
  tuned: 'preset' | 'beds' | 'custom';
}

export interface BedPool {
  n: number;
  aspectStart: number;
  aspectEnd: number;
  aspectSpan: number;
  position: [number, number];
  openness: [number, number];
  steepness: [number, number];
  at: number;
}

export interface BedSample {
  aspect?: number;
  position?: number;
  openness?: number;
  steepness?: number;
}

const PRESETS: Record<TerrainKind, Omit<BedProfile, 'terrain' | 'tuned'>> = {
  // Aspect keeps ~220° and drops the south-facing sector (about 39% of uniform land).
  // Slope position 15–45% is the published band. Openness and steepness are the
  // hillside cluster described around that band; the video did not print those windows.
  hill: { aspectStart: 250, aspectEnd: 110, position: [15, 45], openness: [76, 88], steepness: [10, 28] },
  flat: { aspectStart: 0, aspectEnd: 359, position: [50, 100], openness: [84, 98], steepness: [0, 5] },
  farm: { aspectStart: 0, aspectEnd: 359, position: [10, 60], openness: [80, 94], steepness: [1, 10] },
  piedmont: { aspectStart: 250, aspectEnd: 110, position: [20, 55], openness: [78, 90], steepness: [5, 16] },
  mountain: { aspectStart: 280, aspectEnd: 80, position: [25, 60], openness: [72, 90], steepness: [12, 35] },
};

export const TERRAIN_LABEL: Record<TerrainKind, string> = {
  hill: 'Hill',
  flat: 'Flat',
  farm: 'Farm',
  piedmont: 'Piedmont',
  mountain: 'Mountain',
};

/** Hill country is the study. Every other preset is a starting point. */
export function isStudy(kind: TerrainKind): boolean {
  return kind === 'hill';
}

export function preset(kind: TerrainKind): BedProfile {
  return { terrain: kind, tuned: 'preset', ...PRESETS[kind] };
}

export function aspectSpan(start: number, end: number): number {
  const s = norm(start);
  const e = norm(end);
  return e >= s ? e - s : 360 - s + e;
}

export function aspectMatches(aspect: number, start: number, end: number): boolean {
  if (aspectSpan(start, end) >= 350) return true;
  if (!Number.isFinite(aspect)) return false;
  const s = norm(start);
  const e = norm(end);
  const a = norm(aspect);
  return s <= e ? a >= s && a <= e : a >= s || a <= e;
}

export function isProfile(value: unknown): value is BedProfile {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<BedProfile>;
  return TERRAINS.includes(v.terrain as TerrainKind)
    && Number.isFinite(v.aspectStart)
    && Number.isFinite(v.aspectEnd)
    && pair(v.position, 0, 100)
    && pair(v.openness, 40, 130)
    && pair(v.steepness, 0, 70)
    && (v.tuned === 'preset' || v.tuned === 'beds' || v.tuned === 'custom');
}

export async function loadProfile(repo: Repo): Promise<BedProfile> {
  const saved = await repo.getMeta<unknown>('beds.profile');
  return isProfile(saved) ? saved : preset('hill');
}

export function applyPool(profile: BedProfile, pool: BedPool | null): BedProfile {
  if (!pool || pool.n < 12 || profile.tuned === 'custom' || profile.tuned === 'beds') return profile;
  const next: BedProfile = { ...profile, tuned: 'preset' };
  if (pool.aspectSpan <= 230) {
    next.aspectStart = pool.aspectStart;
    next.aspectEnd = pool.aspectEnd === 0 ? 359 : pool.aspectEnd;
  }
  if (pool.position[1] - pool.position[0] <= 55) next.position = pool.position;
  if (pool.openness[1] - pool.openness[0] <= 22) next.openness = pool.openness;
  if (pool.steepness[1] - pool.steepness[0] <= 28) next.steepness = pool.steepness;
  return next;
}

export function sampleBands(samples: readonly BedSample[]): LandBands {
  const aspect = aspectBand(samples.map(sample => sample.aspect).filter(finite), 0.85);
  const position = linearBand(samples.map(sample => sample.position).filter(finite), 0, 100);
  const openness = linearBand(samples.map(sample => sample.openness).filter(finite), 60, 110);
  const steepness = linearBand(samples.map(sample => sample.steepness).filter(finite), 0, 60);
  return {
    ...(aspect ? { aspect } : {}),
    ...(position ? { position } : {}),
    ...(openness ? { openness } : {}),
    ...(steepness ? { steepness } : {}),
  };
}

export function profileFromBeds(samples: readonly BedSample[], base: BedProfile): BedProfile | null {
  const aspect = aspectBand(samples.map(sample => sample.aspect).filter(finite), 0.85);
  const position = linearBand(samples.map(sample => sample.position).filter(finite), 0, 100);
  const openness = linearBand(samples.map(sample => sample.openness).filter(finite), 60, 110);
  const steepness = linearBand(samples.map(sample => sample.steepness).filter(finite), 0, 60);
  if (!aspect && !position && !openness && !steepness) return null;
  return {
    ...base,
    tuned: 'beds',
    ...(aspect ? { aspectStart: aspect[0], aspectEnd: aspect[1] } : {}),
    ...(position ? { position } : {}),
    ...(openness ? { openness } : {}),
    ...(steepness ? { steepness } : {}),
  };
}

export interface LandBands {
  aspect?: [number, number];
  position?: [number, number];
  openness?: [number, number];
  steepness?: [number, number];
}

/** Central band of the analyzed land, for comparison with logged beds. */
export function landBand(aspect: Float32Array, position: Float32Array, openness: Float32Array, steepness: Float32Array): LandBands {
  const arc = aspectBand(finiteValues(aspect), 0.6);
  const positionBand = linearBand(finiteValues(position), 0, 100);
  const opennessBand = linearBand(finiteValues(openness), 40, 130);
  const steepnessBand = linearBand(finiteValues(steepness), 0, 70);
  return {
    ...(arc ? { aspect: arc } : {}),
    ...(positionBand ? { position: positionBand } : {}),
    ...(opennessBand ? { openness: opennessBand } : {}),
    ...(steepnessBand ? { steepness: steepnessBand } : {}),
  };
}

export function aspectBand(values: readonly number[], cover: number): [number, number] | null {
  if (values.length < 3) return null;
  const bins = new Array<number>(72).fill(0);
  for (const value of values) bins[Math.min(71, Math.floor(norm(value) / 5))]!++;
  const need = Math.ceil(values.length * cover);
  let bestStart = 0;
  let bestLen = 72;
  for (let start = 0; start < 72; start++) {
    let count = 0;
    for (let len = 1; len <= 72; len++) {
      count += bins[(start + len - 1) % 72]!;
      if (count < need) continue;
      if (len < bestLen) { bestLen = len; bestStart = start; }
      break;
    }
  }
  const start = bestStart * 5;
  const end = (bestStart + bestLen) * 5 % 360;
  return [start, end === 0 ? 359 : end];
}

function linearBand(values: readonly number[], min: number, max: number): [number, number] | null {
  if (values.length < 3) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const lo = sorted[Math.floor((sorted.length - 1) * 0.15)]!;
  const hi = sorted[Math.ceil((sorted.length - 1) * 0.85)]!;
  const pad = Math.max(1, (hi - lo) * 0.15);
  const a = clamp(lo - pad, min, max);
  const b = clamp(Math.max(hi + pad, a + 1), min, max);
  return [Math.round(a), Math.round(b)];
}

function finiteValues(values: Float32Array): number[] {
  const out: number[] = [];
  for (const value of values) if (Number.isFinite(value)) out.push(value);
  return out;
}

function finite(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function pair(value: unknown, min: number, max: number): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every(item => typeof item === 'number' && item >= min && item <= max);
}

function norm(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
