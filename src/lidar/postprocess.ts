import { oriented } from "./kernels";
import { LUT } from "./skeletonLut";
import { toLngLat, type Box } from "./ept";
export type XY = [number, number];
export interface Candidate {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: number[][] };
  rawCoordinates?: number[][];
  properties: {
    rank: number;
    score: number;
    calibrated: number;
    length: number;
    status: "Unverified candidate";
  };
}
export interface Candidates {
  type: "FeatureCollection";
  features: Candidate[];
}
import { DETECTION_THRESHOLD } from './model';
const DIR: XY[] = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];
function components(
  mask: Uint8Array,
  w: number,
  h: number,
  diagonal: boolean,
  visit: (indices: number[]) => void,
): void {
  const seen = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++)
    if (mask[i] && !seen[i]) {
      const queue = [i];
      seen[i] = 1;
      for (let head = 0; head < queue.length; head++) {
        const p = queue[head]!,
          y = Math.floor(p / w),
          x = p % w;
        for (const [dy, dx] of DIR) {
          if (!diagonal && dy && dx) continue;
          const yy = y + dy,
            xx = x + dx,
            j = yy * w + xx;
          if (yy >= 0 && yy < h && xx >= 0 && xx < w && mask[j] && !seen[j]) {
            seen[j] = 1;
            queue.push(j);
          }
        }
      }
      visit(queue);
    }
}
export function skeletonize(
  input: Uint8Array,
  w: number,
  h: number,
): Uint8Array {
  let a = input.slice(),
    changed = true;
  const offsets = [-w - 1, -w, -w + 1, 1, w + 1, w, w - 1, -1];
  while (changed) {
    changed = false;
    for (const phase of [1, 2]) {
      const b = a.slice();
      for (let y = 1; y < h - 1; y++)
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (!a[i]) continue;
          let code = 0;
          for (let k = 0; k < 8; k++) code += a[i + offsets[k]!]! << k;
          if (LUT[code] === 3 || LUT[code] === phase) {
            b[i] = 0;
            changed = true;
          }
        }
      a = b;
    }
  }
  return a;
}
export function graphLines(a: Uint8Array, w: number, h: number): XY[][] {
  const edges = new Uint8Array(a.length),
    seen = new Uint8Array(a.length),
    degree = new Uint8Array(a.length),
    out: XY[][] = [];
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!a[i]) continue;
      DIR.forEach(([dy, dx], k) => {
        if (a[i + dy * w + dx] && !(dy && dx && (a[i + dy * w] || a[i + dx]))) {
          edges[i] = edges[i]! | (1 << k);
          degree[i] = degree[i]! + 1;
        }
      });
    }
  for (const junction of [true, false])
    for (let i = 0; i < a.length; i++) {
      if (!a[i] || (degree[i] !== 2) !== junction) continue;
      while (edges[i]! & ~seen[i]!) {
        let p = i;
        const path: XY[] = [[Math.floor(p / w), p % w]];
        while (true) {
          const remaining = edges[p]! & ~seen[p]!;
          if (!remaining) break;
          const k = 31 - Math.clz32(remaining & -remaining),
            [dy, dx] = DIR[k]!,
            q = p + dy * w + dx;
          seen[p] = seen[p]! | (1 << k);
          seen[q] = seen[q]! | (1 << (7 - k));
          p = q;
          path.push([Math.floor(p / w), p % w]);
          if (degree[p] !== 2) break;
        }
        if (path.length > 1) out.push(path);
      }
    }
  return out;
}
export function simplify(points: XY[], tolerance = 1.5): XY[] {
  if (points.length <= 2) return points;
  const a = points[0]!,
    b = points[points.length - 1]!,
    dx = b[0] - a[0],
    dy = b[1] - a[1],
    den = dx * dx + dy * dy;
  let max = 0,
    index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!,
      t = den
        ? Math.max(
            0,
            Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / den),
          )
        : 0,
      d = Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
    if (d > max) {
      max = d;
      index = i;
    }
  }
  return max > tolerance
    ? [
        ...simplify(points.slice(0, index + 1), tolerance).slice(0, -1),
        ...simplify(points.slice(index), tolerance),
      ]
    : [a, b];
}
function sample(
  a: Float32Array,
  w: number,
  h: number,
  x: number,
  y: number,
): number {
  x = Math.max(0, Math.min(w - 1, x));
  y = Math.max(0, Math.min(h - 1, y));
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy;
  return (
    (1 - fy) *
      ((1 - fx) * a[iy * w + ix]! + fx * a[iy * w + Math.min(ix + 1, w - 1)]!) +
    fy *
      ((1 - fx) * a[Math.min(iy + 1, h - 1) * w + ix]! +
        fx * a[Math.min(iy + 1, h - 1) * w + Math.min(ix + 1, w - 1)]!)
  );
}
export interface Calibration {
  x: number[];
  y: number[];
}
export function calibrate(score: number, c: Calibration): number {
  if (score <= c.x[0]!) return c.y[0]!;
  for (let i = 1; i < c.x.length; i++)
    if (score <= c.x[i]!)
      return (
        c.y[i - 1]! +
        ((c.y[i]! - c.y[i - 1]!) * (score - c.x[i - 1]!)) /
          (c.x[i]! - c.x[i - 1]!)
      );
  return c.y[c.y.length - 1]!;
}
export function extract(
  p: Float32Array,
  w: number,
  h: number,
  bb: Box,
  calibration: Calibration,
): Candidates {
  const o = oriented(p, w, h, 12),
    q = Float32Array.from(p, (v, i) =>
      Math.sqrt(Math.max(0, Math.min(1, v)) * Math.max(0, Math.min(1, o[i]!))),
    );
  let m = Uint8Array.from(q, (v) => (v > DETECTION_THRESHOLD ? 1 : 0));
  // Hysteresis uses 4-connectivity, matching scipy.ndimage.label's default.
  components(m, w, h, false, (ids) => {
    if (!ids.some((i) => q[i]! > 0.3)) for (const i of ids) m[i] = 0;
  });
  const dil = new Uint8Array(m.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (
            y + dy >= 0 &&
            y + dy < h &&
            x + dx >= 0 &&
            x + dx < w &&
            m[(y + dy) * w + x + dx]
          )
            dil[i] = 1;
    }
  m = new Uint8Array(m.length);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      let ok = 1;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (!dil[(y + dy) * w + x + dx]) ok = 0;
      m[y * w + x] = ok;
    }
  components(m, w, h, false, (ids) => {
    if (ids.length <= 30) for (const i of ids) m[i] = 0;
  });
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (y < 6 || y >= h - 6 || x < 6 || x >= w - 6) m[y * w + x] = 0;
  const lines = graphLines(skeletonize(m, w, h), w, h),
    features: Candidate[] = [];
  for (const path of lines) {
    const pts = simplify(path.map(([r, c]) => [c, r]));
    const lengths = [0];
    for (let i = 1; i < pts.length; i++)
      lengths.push(
        lengths[i - 1]! +
          Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]),
      );
    const length = lengths[lengths.length - 1]!;
    if (length < 10) continue; // Frozen gap=0 returns spur-filtered lines without min_len filtering.
    const n = Math.max(2, Math.floor(length) + 1);
    let sum = 0,
      segment = 1;
    for (let j = 0; j < n; j++) {
      const d = (length * j) / (n - 1);
      while (segment < lengths.length - 1 && lengths[segment]! < d) segment++;
      const a = pts[segment - 1]!,
        b = pts[segment]!,
        f =
          (d - lengths[segment - 1]!) /
          (lengths[segment]! - lengths[segment - 1]!);
      sum += sample(
        p,
        w,
        h,
        a[0] + f * (b[0] - a[0]),
        a[1] + f * (b[1] - a[1]),
      );
    }
    const score = (sum / n) * Math.log(length);
    features.push({
      type: "Feature",
      rawCoordinates: path.map(([r, c]) => toLngLat([bb[0] + c + 0.5, bb[3] - r - 0.5])),
      geometry: {
        type: "LineString",
        coordinates: pts.map(([x, y]) =>
          toLngLat([bb[0] + x + 0.5, bb[3] - y - 0.5]),
        ),
      },
      properties: {
        rank: 0,
        score,
        calibrated: calibrate(score, calibration),
        length,
        status: "Unverified candidate",
      },
    });
  }
  features.sort(
    (a, b) =>
      b.properties.calibrated - a.properties.calibrated ||
      b.properties.score - a.properties.score,
  );
  features.forEach((f, i) => (f.properties.rank = i + 1));
  return { type: "FeatureCollection", features };
}
