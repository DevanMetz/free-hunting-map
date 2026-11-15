import type { Repo } from '../storage/repo';
import type { LngLat } from '../types';
import { loadElevation, TerrainError } from './dem';
import { computeMetrics, sampleCell, suggestTerrain } from './metrics';
import type { TerrainKind } from './profile';
import { queueBed } from './share';

export async function fillBed(repo: Repo, id: string): Promise<void> {
  const item = await repo.get(id);
  if (!item || item.kind !== 'waypoint' || item.icon !== 'bed' || item.deleted) return;
  if (item.bed?.aspect !== undefined && item.bed.position !== undefined && item.bed.openness !== undefined && item.bed.steepness !== undefined) return;
  const box = pointBox(item.coord);
  let metrics;
  try {
    const grid = await loadElevation(box, new AbortController().signal);
    metrics = computeMetrics(grid.z, grid.cols, grid.rows, grid.dx, grid.dy);
  } catch (err) {
    if (err instanceof TerrainError) return;
    return;
  }
  const sample = sampleCell(metrics, item.coord[0], item.coord[1], ...box);
  if (!sample) return;
  const terrain: TerrainKind = suggestTerrain(metrics);
  const current = await repo.get(id);
  if (!current || current.kind !== 'waypoint' || current.icon !== 'bed' || current.deleted) return;
  const saved = await repo.update(current, { bed: { ...current.bed, ...sample, terrain } });
  if (saved.kind === 'waypoint' && saved.bed) await queueBed(repo, saved.id, saved.coord, terrain, saved.bed);
}

function pointBox(coord: LngLat): [number, number, number, number] {
  const cos = Math.max(0.2, Math.cos(coord[1] * Math.PI / 180));
  const dLat = 320 / 111_320;
  const dLng = 320 / (111_320 * cos);
  return [coord[0] - dLng, coord[1] - dLat, coord[0] + dLng, coord[1] + dLat];
}
