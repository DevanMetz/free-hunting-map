import { haversine, roundCoord } from '../map/geo';
import type { LngLat } from '../types';
import type { WindDir } from '../types';
import type { Ground } from './load';
import type { Pressure } from './pressure';
import { sortWinds, WIND_BEARING, windDir } from './winds';

export interface StandSpot {
  coord: LngLat;
  row: number;
  col: number;
  score: number;
  reasons: string[];
  winds: WindDir[];
  walk: LngLat[];
  access: { coord: LngLat; name: string; meters: number } | null;
}

const FOREST = new Set([41, 42, 43]);
const FIELD = new Set([71, 81, 82]);
const DRY = new Set([31, 41, 42, 43, 52, 71, 81]);
const WET = new Set([90, 95]);
const REASONS = ['Saddle', 'Bluff base', 'Bench', 'Pinch', 'Dry knob', 'Marsh edge', 'Woods edge', 'Sanctuary edge'] as const;

interface Part { reason: (typeof REASONS)[number]; score: number; winds: number[] }

function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function bearing(from: LngLat, to: LngLat): number {
  const lat1 = from[1] * Math.PI / 180;
  const lat2 = to[1] * Math.PI / 180;
  const dLng = (to[0] - from[0]) * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function meanBearing(degs: readonly number[]): number {
  let x = 0;
  let y = 0;
  for (const deg of degs) {
    const r = deg * Math.PI / 180;
    x += Math.sin(r);
    y += Math.cos(r);
  }
  return (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
}

function clampScore(n: number): number {
  return Math.max(0, Math.min(1, n));
}

class Heap {
  private readonly items: { i: number; p: number }[] = [];
  get size(): number { return this.items.length; }
  push(i: number, p: number): void {
    const items = this.items;
    items.push({ i, p });
    let n = items.length - 1;
    while (n > 0) {
      const parent = (n - 1) >> 1;
      if (items[parent]!.p <= items[n]!.p) break;
      const swap = items[parent]!;
      items[parent] = items[n]!;
      items[n] = swap;
      n = parent;
    }
  }
  pop(): { i: number; p: number } | undefined {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (!top || !last || top === last) return top;
    items[0] = last;
    let n = 0;
    for (;;) {
      const left = n * 2 + 1;
      const right = left + 1;
      let best = n;
      if (left < items.length && items[left]!.p < items[best]!.p) best = left;
      if (right < items.length && items[right]!.p < items[best]!.p) best = right;
      if (best === n) break;
      const swap = items[best]!;
      items[best] = items[n]!;
      items[n] = swap;
      n = best;
    }
    return top;
  }
}

export function findStands(grid: Ground, pressure: Pressure, wind: WindDir): StandSpot[] {
  const { cols, rows, cellM } = grid;
  const at = (row: number, col: number): number => row * cols + col;
  const inside = (row: number, col: number): boolean => row >= 0 && col >= 0 && row < rows && col < cols;
  const elev = (row: number, col: number): number => inside(row, col) ? grid.z[at(row, col)]! : Number.NaN;
  const slopeAt = (row: number, col: number): number => inside(row, col) ? grid.slope[at(row, col)]! : Number.NaN;
  const coverAt = (row: number, col: number): number => inside(row, col) ? grid.cover[at(row, col)]! : 0;
  const landAt = (row: number, col: number): number => inside(row, col) ? grid.land[at(row, col)]! : 0;
  const coord = (row: number, col: number): LngLat => [grid.lngOf(col), grid.latOf(row)];
  const step = (row: number, col: number, deg: number, cells: number): [number, number] => {
    const rad = deg * Math.PI / 180;
    return [row - Math.round(Math.cos(rad) * cells), col + Math.round(Math.sin(rad) * cells)];
  };
  const room = (row: number, col: number): number => Math.min(row, col, rows - 1 - row, cols - 1 - col);
  const blockedCover = (cover: number): boolean => cover === 11 || cover === 12 || cover === 23 || cover === 24 || WET.has(cover);
  const scores = new Float32Array(cols * rows);
  const parts = new Map<number, Part[]>();

  for (let row = 1; row < rows - 1; row++) for (let col = 1; col < cols - 1; col++) {
    const index = at(row, col);
    if (landAt(row, col) !== 1) continue;
    const z0 = elev(row, col);
    const slope = slopeAt(row, col);
    const cover = coverAt(row, col);
    if (!Number.isFinite(z0) || !Number.isFinite(slope) || slope > 32) continue;
    if (blockedCover(cover) || cover === 21 || cover === 22) continue;
    const found: Part[] = [];
    const reach = room(row, col);

    if (reach >= 3) {
      const radius = Math.min(5, reach);
      const samples: { deg: number; dz: number }[] = [];
      for (let i = 0; i < 16; i++) {
        const deg = i * 22.5;
        const [r, c] = step(row, col, deg, radius);
        const z = elev(r, c);
        if (Number.isFinite(z)) samples.push({ deg, dz: z - z0 });
      }
      let changes = 0;
      let prev = 0;
      for (const sample of samples) {
        const sign = sample.dz > 2 ? 1 : sample.dz < -2 ? -1 : 0;
        if (!sign) continue;
        if (prev && sign !== prev) changes++;
        prev = sign;
      }
      const first = samples.find(sample => Math.abs(sample.dz) > 2);
      const last = [...samples].reverse().find(sample => Math.abs(sample.dz) > 2);
      if (first && last && ((first.dz > 0) !== (last.dz > 0)) && Math.abs(first.dz) > 2 && Math.abs(last.dz) > 2) changes++;
      const highs = samples.filter(sample => sample.dz >= 4);
      if (changes >= 4 && highs.length >= 2) {
        let pair: [{ deg: number; dz: number }, { deg: number; dz: number }] | null = null;
        let best = 0;
        for (let i = 0; i < highs.length; i++) for (let j = i + 1; j < highs.length; j++) {
          const sep = angleDiff(highs[i]!.deg, highs[j]!.deg);
          if (sep < 120 || sep > 240) continue;
          const rank = Math.min(highs[i]!.dz, highs[j]!.dz) * (1 - Math.abs(sep - 180) / 180);
          if (rank > best) { best = rank; pair = [highs[i]!, highs[j]!]; }
        }
        if (pair) {
          const sides = samples.filter(sample => {
            const left = angleDiff(sample.deg, pair![0].deg + 90);
            const right = angleDiff(sample.deg, pair![0].deg - 90);
            return left <= 35 || right <= 35;
          });
          const side = sides.length ? sides.reduce((sum, sample) => sum + sample.dz, 0) / sides.length : 0;
          const rise = Math.min(pair[0].dz, pair[1].dz);
          const drop = -side;
          if (drop >= 2) {
            const score = clampScore((Math.min(rise, drop) - 2) / 14);
            if (score >= 0.4) found.push({ reason: 'Saddle', score: score * 1.12, winds: [pair[0].deg, pair[1].deg] });
          }
        }
      }
    }

    if (reach >= 3 && slope < 16) {
      let best = 0;
      let up = 0;
      for (let dir = 0; dir < 8; dir++) {
        const deg = dir * 45;
        let rise = 0;
        let steep = 0;
        let ok = true;
        for (let k = 1; k <= 3; k++) {
          const [r, c] = step(row, col, deg, k);
          const z = elev(r, c);
          const s = slopeAt(r, c);
          if (!Number.isFinite(z) || !Number.isFinite(s)) { ok = false; break; }
          rise = z - z0;
          steep = Math.max(steep, s);
        }
        if (!ok || rise < 12 || steep < 20) continue;
        const score = clampScore((rise - 8) / 26);
        if (score > best) { best = score; up = deg; }
      }
      if (best >= 0.4) found.push({ reason: 'Bluff base', score: best, winds: [up + 90, up - 90] });
    }

    if (reach >= 3 && slope < 9) {
      let up = Number.isFinite(grid.aspect[index]!) && slope > 1.5 ? (grid.aspect[index]! + 180) % 360 : Number.NaN;
      if (!Number.isFinite(up)) {
        let rise = 0;
        for (let dir = 0; dir < 8; dir++) {
          const deg = dir * 45;
          const [r, c] = step(row, col, deg, 3);
          const dz = elev(r, c) - z0;
          if (dz > rise) { rise = dz; up = deg; }
        }
      }
      if (Number.isFinite(up)) {
        const [ur, uc] = step(row, col, up, 3);
        const [dr, dc] = step(row, col, up + 180, 3);
        const rise = elev(ur, uc) - z0;
        const drop = z0 - elev(dr, dc);
        const upS = slopeAt(ur, uc);
        const downS = slopeAt(dr, dc);
        if (rise >= 6 && drop >= 5 && upS >= 11 && downS >= 9 && upS >= slope + 5 && downS >= slope + 4) {
          const score = clampScore((Math.min(rise, drop) - 3) / 12);
          if (score >= 0.42) found.push({ reason: 'Bench', score, winds: [up + 90, up - 90] });
        }
      }
    }

    if (slope < 22 && !blockedCover(cover)) {
      let narrow = Infinity;
      let axis = 0;
      let hard = false;
      for (const deg of [0, 45, 90, 135]) {
        const measure = (dir: number): { cells: number; hit: boolean; hard: boolean } => {
          let cells = 0;
          for (let d = 1; d <= 8; d++) {
            const [r, c] = step(row, col, dir, d);
            if (!inside(r, c)) return { cells, hit: false, hard: false };
            const nextCover = coverAt(r, c);
            const nextSlope = slopeAt(r, c);
            const nextLand = landAt(r, c);
            const stop = nextLand !== 1 || nextSlope >= 26 || blockedCover(nextCover);
            if (stop) return { cells, hit: true, hard: nextLand === 2 || nextSlope >= 26 || nextCover === 11 || WET.has(nextCover) };
            cells = d;
          }
          return { cells, hit: false, hard: false };
        };
        const left = measure(deg);
        const right = measure(deg + 180);
        if (!left.hit || !right.hit) continue;
        const width = (left.cells + right.cells + 1) * cellM;
        if (width < narrow) { narrow = width; axis = deg; hard = left.hard || right.hard; }
      }
      if (narrow >= 40 && narrow <= 260) {
        const score = clampScore((260 - narrow) / 200) * (hard ? 1 : 0.85);
        if (score >= 0.4) found.push({ reason: 'Pinch', score, winds: [axis + 90, axis + 270] });
      }
    }

    const neighbors: { dr: number; dc: number; deg: number }[] = [
      { dr: -1, dc: 0, deg: 0 }, { dr: -1, dc: 1, deg: 45 }, { dr: 0, dc: 1, deg: 90 }, { dr: 1, dc: 1, deg: 135 },
      { dr: 1, dc: 0, deg: 180 }, { dr: 1, dc: -1, deg: 225 }, { dr: 0, dc: -1, deg: 270 }, { dr: -1, dc: -1, deg: 315 },
    ];
    if (FOREST.has(cover)) {
      const field = neighbors.filter(n => FIELD.has(coverAt(row + n.dr, col + n.dc)));
      if (field.length) {
        const score = Math.min(0.78, 0.64 + (field.length - 1) * 0.05);
        found.push({ reason: 'Woods edge', score, winds: [meanBearing(field.map(n => n.deg))] });
      }
    }
    if (DRY.has(cover)) {
      const wet = neighbors.filter(n => {
        const code = coverAt(row + n.dr, col + n.dc);
        return WET.has(code) && z0 >= elev(row + n.dr, col + n.dc) - 1;
      });
      if (wet.length) found.push({ reason: 'Marsh edge', score: 0.68, winds: [meanBearing(wet.map(n => n.deg))] });
      if (reach >= 4) {
        let top = true;
        let low = z0;
        let marsh = wet.length > 0;
        const marshDeg: number[] = wet.map(n => n.deg);
        for (let dr = -4; dr <= 4 && top; dr++) for (let dc = -4; dc <= 4; dc++) {
          if (!dr && !dc) continue;
          const z = elev(row + dr, col + dc);
          if (!Number.isFinite(z)) continue;
          if (dr * dr + dc * dc <= 10 && z > z0 + 0.4) top = false;
          if (z < low) low = z;
          if (WET.has(coverAt(row + dr, col + dc))) {
            marsh = true;
            marshDeg.push(bearing(coord(row, col), coord(row + dr, col + dc)));
          }
        }
        if (top && marsh && z0 - low >= 3) {
          found.push({ reason: 'Dry knob', score: 0.84, winds: marshDeg.length ? [meanBearing(marshDeg), meanBearing(marshDeg) + 90, meanBearing(marshDeg) - 90] : [] });
        }
      }
    }

    const sanctuary: number[] = [];
    let touching = false;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      if (!dr && !dc) continue;
      if (landAt(row + dr, col + dc) !== 2) continue;
      if (Math.max(Math.abs(dr), Math.abs(dc)) === 1) touching = true;
      sanctuary.push(bearing(coord(row, col), coord(row + dr, col + dc)));
    }
    if (sanctuary.length) {
      const score = touching ? 0.76 : 0.55;
      found.push({ reason: 'Sanctuary edge', score, winds: [meanBearing(sanctuary)] });
    }

    if (!found.length) continue;
    const here = roundCoord(coord(row, col));
    const roadM = pressure.roadM(here);
    const near = pressure.access(here);
    let score = found.reduce((sum, part) => sum + part.score, 0);
    if (Number.isFinite(roadM)) {
      if (roadM < 30) continue;
      if (roadM < 80) score -= 0.55;
      else if (roadM < 160) score -= 0.32;
      else if (roadM < 300) score -= 0.16;
      else if (roadM < 500) score -= 0.06;
    }
    if (near) {
      if (near.meters < 40) continue;
      if (near.meters < 120) score -= 0.4;
      else if (near.meters < 250) score -= 0.18;
      else if (near.meters < 500) score -= 0.08;
      if (near.pressure === 'heavy') score -= 0.25;
      else if (near.pressure === 'medium') score -= 0.12;
    }
    if (score < 0.42) continue;
    parts.set(index, found);
    scores[index] = score;
  }

  const ranked: { index: number; score: number }[] = [];
  for (const [index] of parts) {
    const row = Math.floor(index / cols);
    const col = index % cols;
    const score = scores[index]!;
    let dominated = false;
    for (let dr = -3; dr <= 3 && !dominated; dr++) for (let dc = -3; dc <= 3; dc++) {
      if (!dr && !dc) continue;
      const r = row + dr;
      const c = col + dc;
      if (!inside(r, c)) continue;
      const other = scores[at(r, c)]!;
      if (other > score + 0.02) dominated = true;
      else if (Math.abs(other - score) <= 0.02 && other > 0 && (r < row || (r === row && c < col))) dominated = true;
    }
    if (!dominated) ranked.push({ index, score });
  }

  ranked.sort((a, b) => b.score - a.score);
  const spots: StandSpot[] = [];
  for (const candidate of ranked) {
    const row = Math.floor(candidate.index / cols);
    const col = candidate.index % cols;
    const spotCoord = roundCoord(coord(row, col));
    const access = pressure.access(spotCoord);
    const score = candidate.score;
    if (spots.some(spot => haversine(spot.coord, spotCoord) < 160)) continue;
    const found = parts.get(candidate.index) ?? [];
    const reasons = REASONS.filter(reason => found.some(part => part.reason === reason));
    const winds = sortWinds(found.flatMap(part => part.winds.map(windDir)));
    spots.push({
      coord: spotCoord,
      row,
      col,
      score,
      reasons: [...reasons],
      winds: winds.length ? winds : [wind],
      walk: [],
      access: access ? { coord: roundCoord(access.coord), name: access.name, meters: access.meters } : null,
    });
    if (spots.length === 8) break;
  }
  applyWind(grid, spots, wind);
  return spots;
}

function terrainCost(grid: Ground, index: number): number {
  const cover = grid.cover[index] ?? 0;
  const slope = grid.slope[index] ?? 0;
  const land = grid.land[index] ?? 0;
  let cost = 1;
  if (FOREST.has(cover)) cost += 0;
  else if (cover === 52 || cover === 71) cost += 0.35;
  else if (cover === 81 || cover === 82 || cover === 31) cost += 1.1;
  else if (WET.has(cover)) cost += 3.5;
  else if (cover === 11 || cover === 12) cost += 12;
  else if (cover >= 21 && cover <= 24) cost += 1.6;
  if (slope > 25) cost += 3;
  if (slope > 35) cost += 8;
  if (land === 2) cost += 40;
  else if (land !== 1) cost += 4;
  if (!Number.isFinite(grid.z[index]!)) cost += 8;
  return cost;
}

function walkIn(grid: Ground, goalRow: number, goalCol: number, windFrom: number, access: LngLat | null): LngLat[] {
  const { cols, rows } = grid;
  const at = (row: number, col: number): number => row * cols + col;
  const coord = (row: number, col: number): LngLat => roundCoord([grid.lngOf(col), grid.latOf(row)]);
  const goal = coord(goalRow, goalCol);
  const nearest = (point: LngLat): { row: number; col: number } => {
    let row = 0;
    let col = 0;
    let best = Infinity;
    for (let r = 0; r < rows; r++) {
      const dLat = Math.abs(grid.latOf(r) - point[1]);
      if (dLat > best) continue;
      for (let c = 0; c < cols; c++) {
        const d = Math.hypot(grid.lngOf(c) - point[0], grid.latOf(r) - point[1]);
        if (d < best) { best = d; row = r; col = c; }
      }
    }
    return { row, col };
  };
  let start = { row: goalRow, col: goalCol };
  let fromAccess: LngLat | null = null;
  if (access && haversine(access, goal) <= 5000) {
    start = nearest(access);
    fromAccess = access;
  } else {
    const down = (windFrom + 180) % 360;
    let best: { row: number; col: number; cost: number } | null = null;
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const point = coord(row, col);
      const dist = haversine(goal, point);
      if (dist < 320 || dist > 900) continue;
      const diff = angleDiff(bearing(goal, point), down);
      if (diff > 70) continue;
      const cost = dist / 80 + terrainCost(grid, at(row, col)) + diff / 25;
      if (!best || cost < best.cost) best = { row, col, cost };
    }
    if (best) start = best;
    else {
      const rad = ((windFrom + 180) % 360) * Math.PI / 180;
      start = {
        row: Math.max(0, Math.min(rows - 1, goalRow - Math.round(Math.cos(rad) * 10))),
        col: Math.max(0, Math.min(cols - 1, goalCol + Math.round(Math.sin(rad) * 10))),
      };
    }
  }

  const goalIndex = at(goalRow, goalCol);
  const startIndex = at(start.row, start.col);
  const prev = new Int32Array(cols * rows).fill(-1);
  const g = new Float64Array(cols * rows);
  g.fill(Infinity);
  g[startIndex] = 0;
  const heuristic = (index: number): number => {
    const row = Math.floor(index / cols);
    const col = index % cols;
    return Math.hypot(row - goalRow, col - goalCol);
  };
  const heap = new Heap();
  heap.push(startIndex, heuristic(startIndex));
  const deltas = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]] as const;
  while (heap.size) {
    const current = heap.pop();
    if (!current) break;
    if (current.p > g[current.i]! + heuristic(current.i) + 1e-6) continue;
    if (current.i === goalIndex) break;
    const row = Math.floor(current.i / cols);
    const col = current.i % cols;
    for (const [dr, dc] of deltas) {
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
      const next = at(r, c);
      const point = coord(r, c);
      const dist = haversine(goal, point);
      let stepCost = terrainCost(grid, next) * (dr !== 0 && dc !== 0 ? 1.414 : 1);
      if (dist > 30 && dist < 320) {
        const diff = angleDiff(bearing(goal, point), windFrom);
        if (diff < 80) stepCost += dist < 160 ? 22 : 8;
      }
      const nextG = g[current.i]! + stepCost;
      if (nextG < g[next]!) {
        g[next] = nextG;
        prev[next] = current.i;
        heap.push(next, nextG + heuristic(next));
      }
    }
  }

  const path: LngLat[] = [];
  if (Number.isFinite(g[goalIndex]!)) {
    const chain: number[] = [];
    let cursor = goalIndex;
    for (let guard = 0; cursor >= 0 && guard < cols * rows; guard++) {
      chain.push(cursor);
      if (cursor === startIndex) break;
      cursor = prev[cursor]!;
    }
    chain.reverse();
    if (chain[0] === startIndex) {
      for (const index of chain) path.push(coord(Math.floor(index / cols), index % cols));
    }
  }
  if (!path.length) path.push(coord(start.row, start.col), goal);
  if (fromAccess && haversine(fromAccess, path[0]!) > 15) path.unshift(roundCoord(fromAccess));
  if (haversine(path[path.length - 1]!, goal) > 5) path.push(goal);
  return simplify(path, 22);
}

function simplify(coords: LngLat[], tolM: number): LngLat[] {
  if (coords.length < 3) return coords.map(roundCoord);
  const keep = new Array<boolean>(coords.length).fill(false);
  keep[0] = true;
  keep[coords.length - 1] = true;
  const mark = (lo: number, hi: number): void => {
    let best = 0;
    let at = -1;
    for (let i = lo + 1; i < hi; i++) {
      const dist = pointSegment(coords[i]!, coords[lo]!, coords[hi]!);
      if (dist > best) { best = dist; at = i; }
    }
    if (at >= 0 && best > tolM) {
      keep[at] = true;
      mark(lo, at);
      mark(at, hi);
    }
  };
  mark(0, coords.length - 1);
  return coords.filter((_, index) => keep[index]).map(roundCoord);
}

function pointSegment(p: LngLat, a: LngLat, b: LngLat): number {
  const mx = 111_320 * Math.max(0.2, Math.cos(p[1] * Math.PI / 180));
  const ax = (a[0] - p[0]) * mx;
  const ay = (a[1] - p[1]) * 111_320;
  const bx = (b[0] - p[0]) * mx;
  const by = (b[1] - p[1]) * 111_320;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (-ax * dx + -ay * dy) / len2));
  return Math.hypot(ax + dx * t, ay + dy * t);
}

export function applyWind(grid: Ground, spots: StandSpot[], wind: WindDir): void {
  const deg = WIND_BEARING[wind];
  for (const spot of spots) spot.walk = walkIn(grid, spot.row, spot.col, deg, spot.access && spot.access.meters <= 5000 ? spot.access.coord : null);
}
