import type { LngLat } from '../../types';
import { roundCoord } from '../geo';
import { uuid } from '../../sync/ids';
import type { Repo } from '../../storage/repo';

export const PRESSURE_LEVELS = ['light', 'medium', 'heavy'] as const;
export type PressureLevel = (typeof PRESSURE_LEVELS)[number];
export const PRESSURE_LABEL: Record<PressureLevel, string> = { light: 'Light', medium: 'Medium', heavy: 'Heavy' };

export interface Pullout {
  id: string;
  name: string;
  capacity: string;
  gate: string;
  boulders: string;
  note: string;
  coord: LngLat;
  updatedAt: number;
}

export interface PressureReport {
  id: string;
  spotId: string;
  level: PressureLevel;
  at: number;
}

const PULLOUTS = 'access.pullouts';
const REPORTS = 'access.pressure';
const text = (value: unknown, max: number): string => typeof value === 'string' ? value.trim().slice(0, max) : '';

function pullout(value: unknown): Pullout | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const coord = record.coord;
  if (!Array.isArray(coord) || coord.length < 2 || typeof coord[0] !== 'number' || typeof coord[1] !== 'number') return null;
  if (!Number.isFinite(coord[0]) || !Number.isFinite(coord[1]) || Math.abs(coord[0]) > 180 || Math.abs(coord[1]) > 90) return null;
  const id = text(record.id, 80);
  if (!id) return null;
  return {
    id,
    name: text(record.name, 120),
    capacity: text(record.capacity, 200),
    gate: text(record.gate, 200),
    boulders: text(record.boulders, 200),
    note: text(record.note, 500),
    coord: roundCoord([coord[0], coord[1]]),
    updatedAt: typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt) ? record.updatedAt : 0,
  };
}

function report(value: unknown): PressureReport | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const level = record.level;
  const id = text(record.id, 80);
  const spotId = text(record.spotId, 120);
  if (!id || !spotId || (level !== 'light' && level !== 'medium' && level !== 'heavy')) return null;
  if (typeof record.at !== 'number' || !Number.isFinite(record.at)) return null;
  return { id, spotId, level, at: record.at };
}

export class AccessStore extends EventTarget {
  pullouts: Pullout[] = [];
  reports: PressureReport[] = [];
  private writes: Promise<unknown> = Promise.resolve();

  constructor(private repo: Repo) { super(); }

  async load(): Promise<void> {
    const [pullouts, reports] = await Promise.all([
      this.repo.getMeta<unknown>(PULLOUTS),
      this.repo.getMeta<unknown>(REPORTS),
    ]);
    this.pullouts = Array.isArray(pullouts) ? pullouts.flatMap(item => { const next = pullout(item); return next ? [next] : []; }) : [];
    this.reports = Array.isArray(reports) ? reports.flatMap(item => { const next = report(item); return next ? [next] : []; }) : [];
    this.dispatchEvent(new Event('change'));
  }

  pullout(id: string): Pullout | undefined { return this.pullouts.find(item => item.id === id); }

  reportsFor(spotId: string): PressureReport[] {
    return this.reports.filter(item => item.spotId === spotId).sort((a, b) => b.at - a.at);
  }

  createPullout(coord: LngLat): Pullout {
    const next: Pullout = { id: uuid(), name: '', capacity: '', gate: '', boulders: '', note: '', coord: roundCoord(coord), updatedAt: Date.now() };
    this.pullouts = [...this.pullouts, next].slice(-300);
    this.persistPullouts();
    this.dispatchEvent(new Event('change'));
    return next;
  }

  updatePullout(id: string, patch: Partial<Pick<Pullout, 'name' | 'capacity' | 'gate' | 'boulders' | 'note'>>): void {
    this.pullouts = this.pullouts.map(item => item.id === id ? {
      ...item,
      name: patch.name !== undefined ? text(patch.name, 120) : item.name,
      capacity: patch.capacity !== undefined ? text(patch.capacity, 200) : item.capacity,
      gate: patch.gate !== undefined ? text(patch.gate, 200) : item.gate,
      boulders: patch.boulders !== undefined ? text(patch.boulders, 200) : item.boulders,
      note: patch.note !== undefined ? text(patch.note, 500) : item.note,
      updatedAt: Date.now(),
    } : item);
    this.persistPullouts();
    this.dispatchEvent(new Event('change'));
  }

  deletePullout(id: string): void {
    this.pullouts = this.pullouts.filter(item => item.id !== id);
    this.reports = this.reports.filter(item => item.spotId !== `pullout:${id}`);
    this.persistPullouts();
    this.persistReports();
    this.dispatchEvent(new Event('change'));
  }

  addReport(spotId: string, level: PressureLevel): void {
    const next: PressureReport = { id: uuid(), spotId, level, at: Date.now() };
    const kept = this.reports.filter(item => item.spotId !== spotId);
    const own = [...this.reports.filter(item => item.spotId === spotId), next].slice(-30);
    this.reports = [...kept, ...own].slice(-1000);
    this.persistReports();
    this.dispatchEvent(new Event('change'));
  }

  private persistPullouts(): void {
    const snapshot = this.pullouts;
    this.enqueue(() => this.repo.setMeta(PULLOUTS, snapshot));
  }

  private persistReports(): void {
    const snapshot = this.reports;
    this.enqueue(() => this.repo.setMeta(REPORTS, snapshot));
  }

  private enqueue(write: () => Promise<void>): void {
    const run = this.writes.then(write);
    this.writes = run.catch(() => {});
  }
}

export let accessStore: AccessStore | undefined;

export async function startAccessStore(repo: Repo): Promise<void> {
  accessStore = new AccessStore(repo);
  try { await accessStore.load(); } catch { /* Notes can still be added in this session. */ }
}
