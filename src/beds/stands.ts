import type { BedProfile } from './profile';
import { computeMetrics, maskOf, type Metrics } from './metrics';

export interface BedHint {
  mask: Uint8Array;
  hillside: Uint8Array;
  position: Float32Array;
  aspect: Float32Array;
  beds: Int32Array;
  fields: Int32Array;
  cols: number;
  rows: number;
  cellM: number;
}

const FIELD = new Set([71, 81, 82]);

export function prepareBeds(z: Float32Array, cover: Uint8Array, cols: number, rows: number, cellM: number, profile: BedProfile): BedHint {
  const metrics = computeMetrics(z, cols, rows, cellM, cellM);
  return hintFrom(metrics, cover, profile, cellM);
}

export function hintFrom(metrics: Metrics, cover: Uint8Array, profile: BedProfile, cellM: number): BedHint {
  const mask = maskOf(metrics, profile, 'all');
  const hillside = maskOf(metrics, profile, 'hillside');
  const beds: number[] = [];
  const fields: number[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) beds.push(i);
    if (FIELD.has(cover[i] ?? 0)) fields.push(i);
  }
  return {
    mask,
    hillside,
    position: metrics.position,
    aspect: metrics.aspect,
    beds: thin(beds, 480),
    fields: thin(fields, 480),
    cols: metrics.cols,
    rows: metrics.rows,
    cellM,
  };
}

/** A stand between a likely bed and a field, or merely near a bed. */
export function bedPlacement(hint: BedHint, row: number, col: number): { between: boolean; near: boolean; axis: number } | null {
  if (!hint.beds.length) return null;
  const reach = 460 / hint.cellM;
  let best = -1;
  let bestD = reach;
  for (const index of hint.beds) {
    const r = Math.floor(index / hint.cols);
    const c = index % hint.cols;
    const dist = Math.hypot(r - row, c - col);
    if (dist < bestD && dist > 1) { bestD = dist; best = index; }
  }
  if (best < 0) return null;
  const bedRow = Math.floor(best / hint.cols);
  const bedCol = best % hint.cols;
  let between = false;
  let axis = 0;
  const food = 540 / hint.cellM;
  for (const index of hint.fields) {
    const r = Math.floor(index / hint.cols);
    const c = index % hint.cols;
    const along = segmentT(col, row, bedCol, bedRow, c, r);
    const off = segmentDistance(col, row, bedCol, bedRow, c, r);
    if (off < 80 / hint.cellM && along > 0.15 && along < 0.85 && Math.hypot(r - bedRow, c - bedCol) < food + reach) {
      between = true;
      axis = (Math.atan2(c - bedCol, bedRow - r) * 180 / Math.PI + 360) % 360;
      break;
    }
  }
  return { between, near: bestD * hint.cellM < 300 && bestD * hint.cellM > 40, axis };
}

function thin(indexes: number[], cap: number): Int32Array {
  if (indexes.length <= cap) return Int32Array.from(indexes);
  const stride = Math.ceil(indexes.length / cap);
  const out: number[] = [];
  for (let i = 0; i < indexes.length; i += stride) out.push(indexes[i]!);
  return Int32Array.from(out);
}

function segmentT(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  if (!len) return 0;
  return ((px - ax) * dx + (py - ay) * dy) / len;
}

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const t = Math.max(0, Math.min(1, segmentT(px, py, ax, ay, bx, by)));
  const dx = bx - ax;
  const dy = by - ay;
  return Math.hypot(ax + dx * t - px, ay + dy * t - py);
}
