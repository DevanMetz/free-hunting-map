import type { Map as MlMap } from 'maplibre-gl';
import type { Repo } from '../storage/repo';
import { limitBox, type BBox } from '../stands/load';
import { loadElevation, TerrainError, type ElevationGrid, gridShape } from './dem';
import { computeMetrics, maskOf, suggestTerrain, type Metrics } from './metrics';
import { applyPool, isProfile, preset, type BedProfile, type TerrainKind } from './profile';
import { beddingOpacity, beddingVisible, installBedding, paintBedding, shadeCanvas } from './overlay';
import { stateOf } from './region';
import { cachedPool } from './share';

export interface BedState {
  profile: BedProfile;
  metrics: Metrics | null;
  box: BBox | null;
  status: string;
  busy: boolean;
  suggested: TerrainKind | null;
  pooled: string;
}

let repo: Repo | undefined;
let profile: BedProfile = preset('hill');
let fresh = true;
let metrics: Metrics | null = null;
let box: BBox | null = null;
let status = '';
let busy = false;
let suggested: TerrainKind | null = null;
let pooled = '';
let runId = 0;
let runAbort: AbortController | undefined;
let hold = 0;
let saveTimer = 0;
const memory = new Map<string, ElevationGrid>();
const listeners = new Set<() => void>();

export async function bindBedding(store: Repo): Promise<void> {
  repo = store;
  const saved = await store.getMeta<unknown>('beds.profile');
  if (isProfile(saved)) { profile = saved; fresh = false; }
  notify();
}

export function beddingState(): BedState {
  return { profile, metrics, box, status, busy, suggested, pooled };
}

export function subscribeBedding(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function holdBedding(): void { hold++; }
export function releaseBedding(): void { hold = Math.max(0, hold - 1); }

export function attachBedding(map: MlMap, beforeId?: string): void {
  installBedding(map, beforeId);
  repaintBedding();
}

export function showBedding(on: boolean, map?: MlMap): void {
  beddingVisible(on);
  if (!on || !map || hold) return;
  const raw = viewBox(map);
  const limited = limitBox(raw);
  if (!limited) return;
  if (metrics && box && closeBox(box, limited)) { repaintBedding(); return; }
  analyzeBedding(raw);
}

export function fadeBedding(value: number): void {
  beddingOpacity(value);
}

export function editBedProfile(next: BedProfile): void {
  profile = { ...next, tuned: next.tuned === 'preset' ? 'custom' : next.tuned };
  fresh = false;
  pooled = '';
  remember();
  repaintBedding();
  notify();
}

export async function chooseTerrain(kind: TerrainKind): Promise<void> {
  let next = preset(kind);
  pooled = '';
  if (repo && box) {
    const region = stateOf((box[0] + box[2]) / 2, (box[1] + box[3]) / 2);
    const pool = await cachedPool(repo, region, kind);
    next = applyPool(next, pool);
    if (pool && pool.n >= 12) pooled = `${region} ${pool.n}`;
  }
  profile = next;
  fresh = false;
  remember();
  repaintBedding();
  notify();
}

export function analyzeBedding(raw: BBox): void {
  const limited = limitBox(raw);
  if (!limited) { status = 'Area too small'; notify(); return; }
  const id = ++runId;
  runAbort?.abort();
  const controller = runAbort = new AbortController();
  busy = true;
  status = '';
  box = limited;
  notify();
  void run(limited, id, controller.signal);
}

export function repaintBedding(): void {
  if (!metrics || !box) return;
  paintBedding(shadeCanvas(maskOf(metrics, profile, 'all'), metrics.cols, metrics.rows), box);
}

async function run(limited: BBox, id: number, signal: AbortSignal): Promise<void> {
  try {
    const grid = await cachedElevation(limited, signal);
    if (id !== runId || signal.aborted) return;
    metrics = computeMetrics(grid.z, grid.cols, grid.rows, grid.dx, grid.dy);
    box = grid.box;
    suggested = suggestTerrain(metrics);
    pooled = '';
    if (fresh) {
      profile = preset(suggested);
      fresh = false;
    }
    if (repo && profile.tuned === 'preset') {
      const region = stateOf((box[0] + box[2]) / 2, (box[1] + box[3]) / 2);
      const pool = await cachedPool(repo, region, profile.terrain);
      if (id !== runId || signal.aborted) return;
      profile = applyPool(profile, pool);
      pooled = pool && pool.n >= 12 ? `${region} ${pool.n}` : '';
    }
    remember();
    repaintBedding();
    status = '';
  } catch (err) {
    if (id !== runId || signal.aborted) return;
    metrics = null;
    status = err instanceof TerrainError ? err.message : 'Elevation unavailable';
  } finally {
    if (id === runId) { busy = false; notify(); }
  }
}

async function cachedElevation(limited: BBox, signal: AbortSignal): Promise<ElevationGrid> {
  const shape = gridShape(limited);
  const key = `${limited.map(value => value.toFixed(3)).join(',')}|${shape.cols}x${shape.rows}`;
  const hit = memory.get(key);
  if (hit) return hit;
  if (repo) {
    const saved = await repo.getMeta<ElevationGrid & { key?: string }>('beds.grid');
    if (saved?.key === key && saved.z instanceof Float32Array && saved.z.length === saved.cols * saved.rows) {
      memory.set(key, saved);
      return saved;
    }
  }
  const grid = await loadElevation(limited, signal);
  const stored = { ...grid, key };
  memory.set(key, stored);
  if (memory.size > 3) memory.delete(memory.keys().next().value!);
  void repo?.setMeta('beds.grid', stored);
  return stored;
}

function remember(): void {
  if (!repo) return;
  clearTimeout(saveTimer);
  const snapshot = profile;
  saveTimer = window.setTimeout(() => { void repo?.setMeta('beds.profile', snapshot); }, 200);
}

function viewBox(map: MlMap): BBox {
  const bounds = map.getBounds();
  return [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
}

function closeBox(a: BBox, b: BBox): boolean {
  return a.every((value, index) => Math.abs(value - b[index]!) < 0.002);
}

function notify(): void {
  for (const listener of listeners) listener();
}
