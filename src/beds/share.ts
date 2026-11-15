import type { Repo } from '../storage/repo';
import type { LngLat } from '../types';
import { stateOf } from './region';
import type { BedPool, TerrainKind } from './profile';

/** Same week-long delay as public activity, so a fresh bed cannot be followed. */
const DELAY_MS = 7 * 24 * 60 * 60 * 1000;
const QUEUE = 'beds.queue';
const SHARE = 'beds.share';

export interface QueuedBed {
  id: string;
  pinId: string;
  readyAt: number;
  terrain: TerrainKind;
  region: string;
  aspect: number;
  position: number;
  openness: number;
  steepness: number;
}

const TERRAINS = new Set<TerrainKind>(['hill', 'flat', 'farm', 'piedmont', 'mountain']);

export async function bedSharing(repo: Repo): Promise<boolean> {
  return await repo.getMeta<boolean>(SHARE) === true;
}

export async function setBedSharing(repo: Repo, on: boolean): Promise<void> {
  await repo.setMeta(SHARE, on);
  if (!on) await repo.setMeta(QUEUE, []);
}

export async function queueBed(repo: Repo, pinId: string, coord: LngLat, terrain: TerrainKind, metrics: { aspect?: number; position?: number; openness?: number; steepness?: number }): Promise<void> {
  if (await repo.getMeta<boolean>(SHARE) !== true) return;
  const region = stateOf(coord[0], coord[1]);
  if (!region) return;
  if (![metrics.aspect, metrics.position, metrics.openness, metrics.steepness].every(value => typeof value === 'number' && Number.isFinite(value))) return;
  const queue = await readQueue(repo);
  if (queue.some(row => row.pinId === pinId)) return;
  queue.push({
    id: hex(16),
    pinId,
    readyAt: Date.now() + DELAY_MS,
    terrain,
    region,
    aspect: Math.round(metrics.aspect!),
    position: Math.round(metrics.position!),
    openness: Math.round(metrics.openness! * 10),
    steepness: Math.round(metrics.steepness! * 10),
  });
  await repo.setMeta(QUEUE, queue.slice(-200));
}

export async function forgetBed(repo: Repo, pinId: string): Promise<void> {
  const queue = await readQueue(repo);
  const next = queue.filter(row => row.pinId !== pinId);
  if (next.length !== queue.length) await repo.setMeta(QUEUE, next);
}

export async function flushBeds(repo: Repo): Promise<void> {
  if (await repo.getMeta<boolean>(SHARE) !== true) return;
  const queue = await readQueue(repo);
  const due = queue.filter(row => row.readyAt <= Date.now());
  if (!due.length) return;
  let response: Response;
  try {
    response = await fetch('/api/community/beds', {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stats: due.map(row => ({
          id: row.id,
          terrain: row.terrain,
          region: row.region,
          aspect: row.aspect,
          position: row.position,
          openness: row.openness,
          steepness: row.steepness,
        })),
      }),
    });
  } catch {
    return;
  }
  if (!response.ok) return;
  const sent = new Set(due.map(row => row.id));
  await repo.setMeta(QUEUE, queue.filter(row => !sent.has(row.id)));
}

export function startBedShare(repo: Repo): void {
  const run = (): void => { void flushBeds(repo); };
  run();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) run(); });
  window.setInterval(run, 30 * 60 * 1000);
}

export async function cachedPool(repo: Repo, region: string, terrain: TerrainKind): Promise<BedPool | null> {
  if (!region) return null;
  const key = poolKey(region, terrain);
  const saved = await repo.getMeta<BedPool>(key);
  if (saved && saved.n >= 0 && Date.now() - saved.at < 24 * 60 * 60 * 1000) return saved;
  try {
    const response = await fetch(`/api/community/beds?region=${region}&terrain=${terrain}`, { credentials: 'omit' });
    if (!response.ok) return saved ?? null;
    const pool = parsePool(await response.json());
    if (!pool) return saved ?? null;
    await repo.setMeta(key, pool);
    return pool;
  } catch {
    return saved ?? null;
  }
}

function parsePool(value: unknown): BedPool | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const n = num(row.n);
  if (n === null || n < 0) return null;
  if (n < 12) return { n, aspectStart: 0, aspectEnd: 359, aspectSpan: 360, position: [0, 100], openness: [70, 100], steepness: [0, 40], at: Date.now() };
  const aspectStart = num(row.aspectStart);
  const aspectEnd = num(row.aspectEnd);
  const aspectSpan = num(row.aspectSpan);
  const position = pair(row.position, 0, 100);
  const openness = pair(row.openness, 40, 130);
  const steepness = pair(row.steepness, 0, 70);
  if (aspectStart === null || aspectEnd === null || aspectSpan === null || !position || !openness || !steepness) return null;
  return { n, aspectStart, aspectEnd, aspectSpan, position, openness, steepness, at: Date.now() };
}

async function readQueue(repo: Repo): Promise<QueuedBed[]> {
  const saved = await repo.getMeta<QueuedBed[]>(QUEUE);
  if (!Array.isArray(saved)) return [];
  return saved.filter(row => row && typeof row.id === 'string' && typeof row.pinId === 'string' && TERRAINS.has(row.terrain) && typeof row.region === 'string');
}

function poolKey(region: string, terrain: TerrainKind): string {
  return `beds.pool.${region}.${terrain}`;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function pair(value: unknown, min: number, max: number): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [a, b] = value;
  if (typeof a !== 'number' || typeof b !== 'number' || a < min || b > max || a > b) return null;
  return [a, b];
}

function hex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
}
