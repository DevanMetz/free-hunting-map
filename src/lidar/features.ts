import { gaussian, gradient, half, oriented, sato, uniform } from "./kernels";
export interface Normalization {
  channels: string[];
  median: number[];
  scale: number[];
}
export function downsample(
  a: Float32Array,
  w: number,
  h: number,
  max = false,
): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * 2 * w * 2 + x * 2,
        v = [a[i]!, a[i + 1]!, a[i + 2 * w]!, a[i + 2 * w + 1]!];
      out[y * w + x] = max
        ? Math.max(...v)
        : Math.fround(Math.fround(v[0]! + v[1]!) + Math.fround(v[2]! + v[3]!)) /
          4;
    }
  return out;
}
export function demFeatures(
  dtm05: Float32Array,
  w: number,
  h: number,
): Record<string, Float32Array> {
  const dtm = downsample(dtm05, w, h),
    smooth = gaussian(dtm, w, h, 1);
  const gy = gradient(smooth, w, h, 0),
    gx = gradient(smooth, w, h, 1);
  const slope = Float32Array.from(
    gx,
    (v, i) => (Math.atan(Math.hypot(v, gy[i]!)) * 180) / Math.PI,
  );
  const f: Record<string, Float32Array> = { slope };
  for (const az of [315, 45, 135, 225]) {
    const a = (az * Math.PI) / 180,
      alt = (40 * Math.PI) / 180;
    f[`hs_${az}`] = Float32Array.from(gx, (v, i) =>
      Math.max(
        0,
        Math.min(
          1,
          (Math.sin(alt) -
            Math.cos(alt) * (v * Math.sin(a) - gy[i]! * Math.cos(a))) /
            Math.sqrt(1 + v * v + gy[i]! ** 2),
        ),
      ),
    );
  }
  for (const s of [3, 7]) {
    const z = gaussian(dtm, w, h, s),
      lrm = Float32Array.from(dtm, (v, i) => v - z[i]!);
    f[`lrm_${s}`] = lrm;
    if (s === 7) {
      const mean = uniform(lrm, w, h, s),
        sq = uniform(
          Float32Array.from(lrm, (v) => v * v),
          w,
          h,
          s,
        );
      f.rstd_7 = Float32Array.from(sq, (v, i) =>
        Math.sqrt(Math.max(0, v - mean[i]! ** 2)),
      );
    }
  }
  const z = gaussian(dtm05, 2 * w, 2 * h, 4),
    l05 = Float32Array.from(dtm05, (v, i) => v - z[i]!);
  const [valley, ridge] = sato(l05, 2 * w, 2 * h);
  f.fine_valley = downsample(valley, w, h, true);
  f.fine_ridge = downsample(ridge, w, h, true);
  const s7 = gaussian(slope, w, h, 7),
    s1 = gaussian(slope, w, h, 1);
  f.bench = Float32Array.from(s7, (v, i) => v - s1[i]!);
  f.line_bench = oriented(f.bench, w, h, 8);
  return f;
}
/** Zoom order=1, grid_mode=False: endpoint aligned like scipy.ndimage.zoom. */
export function zoom2(a: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(4 * w * h);
  for (let y = 0; y < 2 * h; y++)
    for (let x = 0; x < 2 * w; x++) {
      const sy = (y * (h - 1)) / (2 * h - 1),
        sx = (x * (w - 1)) / (2 * w - 1),
        iy = Math.floor(sy),
        ix = Math.floor(sx),
        fy = sy - iy,
        fx = sx - ix;
      out[y * 2 * w + x] =
        (1 - fy) *
          ((1 - fx) * a[iy * w + ix]! +
            fx * a[iy * w + Math.min(ix + 1, w - 1)]!) +
        fy *
          ((1 - fx) * a[Math.min(iy + 1, h - 1) * w + ix]! +
            fx * a[Math.min(iy + 1, h - 1) * w + Math.min(ix + 1, w - 1)]!);
    }
  return out;
}
export function fillGround(
  sums: Float64Array,
  counts: Uint32Array,
  d3: Float32Array,
  w: number,
  h: number,
): Float32Array {
  const base = zoom2(d3, w, h),
    valid = Float32Array.from(counts, (n) => (n > 0 ? 1 : 0));
  const off = Float32Array.from(sums, (v, i) =>
    counts[i] ? v / counts[i]! - base[i]! : 0,
  );
  const weight = gaussian(valid, 2 * w, 2 * h, 4),
    offset = gaussian(off, 2 * w, 2 * h, 4);
  return Float32Array.from(base, (v, i) =>
    counts[i]
      ? sums[i]! / counts[i]!
      : v + (weight[i]! > 1e-3 ? offset[i]! / Math.max(weight[i]!, 1e-3) : 0),
  );
}
export function normalize(
  features: Record<string, Float32Array>,
  st: Normalization,
): Float32Array[] {
  return st.channels.map((name, c) =>
    Float32Array.from(features[name]!, (v) =>
      Math.max(
        -5,
        Math.min(5, Math.fround(half(v) - st.median[c]!) / st.scale[c]!),
      ),
    ),
  );
}
