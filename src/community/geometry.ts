export type Point = [number, number];
export type BBox = [number, number, number, number];
export interface Detection { coordinates: Point[]; confidence: number }
export interface Scan { model: string; day: string; area: BBox; threshold?: number; sources?: string[]; lines: Detection[] }
export interface CommunityLine extends Detection {
  id: string;
  scan_count: number;
  model: string;
  first_seen: string;
  last_confirmed: string;
}

export const bbox = (points: Point[]): BBox => [
  Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])),
  Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1])),
];
export const intersects = (a: BBox, b: BBox) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
const project = (p: Point, lat: number): Point => [p[0] * 111320 * Math.cos(lat * Math.PI / 180), p[1] * 111320];
function distance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
export function simplify(points: Point[], tolerance = 2.5): Point[] {
  if (points.length < 3) return points;
  const projected = points.map(p => project(p, points[0]![1]));
  const keep = new Set([0, points.length - 1]), stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let best = tolerance, index = -1;
    for (let i = a + 1; i < b; i++) {
      const d = distance(projected[i]!, projected[a]!, projected[b]!);
      if (d > best) { best = d; index = i; }
    }
    if (index >= 0) { keep.add(index); stack.push([a, index], [index, b]); }
  }
  return [...keep].sort((a, b) => a - b).map(i => points[i]!);
}
/** Sample length every four metres so long simplified segments cannot skip crossings. */
export function confirms(incoming: Point[], existing: Point[]): boolean {
  const lat = incoming[0]![1], a = incoming.map(p => project(p, lat)), b = existing.map(p => project(p, lat));
  let total = 0, near = 0;
  for (let i = 1; i < a.length; i++) {
    const p = a[i - 1]!, q = a[i]!;
    const length = Math.hypot(q[0] - p[0], q[1] - p[1]), steps = Math.ceil(length / 4);
    for (let j = 0; j < steps; j++) {
      const t = (j + .5) / steps;
      const point: Point = [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])];
      for (let k = 1; k < b.length; k++) {
        if (distance(point, b[k - 1]!, b[k]!) <= 8) { near += length / steps; break; }
      }
    }
    total += length;
  }
  return total > 0 && near / total >= .6;
}
export function mergeScan(scan: Scan, existing: CommunityLine[], id: () => string): CommunityLine[] {
  const lines = existing.map(l => ({ ...l })), changed = new Map<string, CommunityLine>();
  for (const detection of scan.lines) {
    const bounds = bbox(detection.coordinates), pad = .0003;
    const expanded: BBox = [bounds[0] - pad, bounds[1] - pad, bounds[2] + pad, bounds[3] + pad];
    const match = lines.find(l => intersects(bbox(l.coordinates), expanded) && confirms(detection.coordinates, l.coordinates));
    if (match) {
      if (changed.has(match.id)) continue;
      match.confidence = (match.confidence * match.scan_count + detection.confidence) / (match.scan_count + 1);
      match.scan_count++;
      match.first_seen = match.first_seen < scan.day ? match.first_seen : scan.day;
      match.model = scan.model;
      match.last_confirmed = match.last_confirmed > scan.day ? match.last_confirmed : scan.day;
      changed.set(match.id, match);
    } else {
      const line = { ...detection, id: id(), scan_count: 1, model: scan.model, first_seen: scan.day, last_confirmed: scan.day };
      lines.push(line);
      changed.set(line.id, line);
    }
  }
  return [...changed.values()];
}
export const tileXY = (lng: number, lat: number): [number, number] => [
  Math.min(4095, Math.floor((lng + 180) / 360 * 4096)),
  Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * 4096),
];
/** Conservative bbox indexing includes every tile touched by the line. */
export function tiles(area: BBox): string[] {
  const [x0, y1] = tileXY(area[0], area[1]), [x1, y0] = tileXY(area[2], area[3]);
  const result: string[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) result.push(`${x}/${y}`);
  return result;
}
