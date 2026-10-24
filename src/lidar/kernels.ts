/** SciPy-compatible half-sample reflection and separable float32 filters. */
export function reflect(i: number, n: number): number {
  const j = ((i % (2 * n)) + 2 * n) % (2 * n);
  return j < n ? j : 2 * n - j - 1;
}
export function filter(
  a: Float32Array,
  w: number,
  h: number,
  k: number[],
  axis: number,
): Float32Array {
  const b = new Float32Array(a.length),
    r = k.length >> 1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let j = 0; j < k.length; j++)
        if (k[j])
          v +=
            k[j]! *
            a[
              axis === 0
                ? reflect(y + j - r, h) * w + x
                : y * w + reflect(x + j - r, w)
            ]!;
      b[y * w + x] = v;
    }
  return b;
}
export function gaussian(
  a: Float32Array,
  w: number,
  h: number,
  sigma: number,
  orders = [0, 0],
  truncate = 4,
): Float32Array {
  // Terms below 1e-20 are numerically irrelevant, including Sato's truncate=100.
  const r = Math.min(Math.floor(truncate * sigma + 0.5), Math.ceil(10 * sigma));
  const k = Array.from({ length: 2 * r + 1 }, (_, i) =>
    Math.exp(-0.5 * ((i - r) / sigma) ** 2),
  );
  const sum = k.reduce((a, b) => a + b, 0);
  const smooth = k.map((v) => v / sum),
    deriv = smooth.map((v, i) => (v * (i - r)) / (sigma * sigma));
  return filter(
    filter(a, w, h, orders[0] ? deriv : smooth, 0),
    w,
    h,
    orders[1] ? deriv : smooth,
    1,
  );
}
export function uniform(
  a: Float32Array,
  w: number,
  h: number,
  size: number,
): Float32Array {
  return filter(
    filter(a, w, h, Array(size).fill(1 / size), 0),
    w,
    h,
    Array(size).fill(1 / size),
    1,
  );
}
export function gradient(
  a: Float32Array,
  w: number,
  h: number,
  axis: number,
): Float32Array {
  return Float32Array.from(a, (_, i) => {
    const x = i % w,
      y = Math.floor(i / w),
      p = axis ? x : y,
      n = axis ? w : h,
      stride = axis ? 1 : w;
    return p === 0
      ? a[i + stride]! - a[i]!
      : p === n - 1
        ? a[i]! - a[i - stride]!
        : (a[i + stride]! - a[i - stride]!) / 2;
  });
}
export function sato(
  a: Float32Array,
  w: number,
  h: number,
): [Float32Array, Float32Array] {
  const valley = new Float32Array(a.length),
    ridge = new Float32Array(a.length);
  for (const sigma of [1, 2]) {
    const s = sigma / Math.sqrt(2),
      t = sigma > 1 ? 8 : 100;
    const gy = gaussian(a, w, h, s, [1, 0], t),
      gx = gaussian(a, w, h, s, [0, 1], t);
    const yy = gaussian(gy, w, h, s, [1, 0], t),
      xy = gaussian(gy, w, h, s, [0, 1], t),
      xx = gaussian(gx, w, h, s, [0, 1], t);
    for (let i = 0; i < a.length; i++) {
      const d = Math.hypot(xx[i]! - yy[i]!, 2 * xy[i]!);
      valley[i] = Math.max(
        valley[i]!,
        (sigma ** 2 * (xx[i]! + yy[i]! + d)) / 2,
      );
      ridge[i] = Math.max(ridge[i]!, (sigma ** 2 * (-xx[i]! - yy[i]! + d)) / 2);
    }
  }
  return [valley, ridge];
}
/** Python round() uses ties-to-even. */
export function evenRound(x: number): number {
  const f = Math.floor(x);
  return x - f === 0.5 ? f + (f % 2) : Math.round(x);
}
export function oriented(
  a: Float32Array,
  w: number,
  h: number,
  count: number,
): Float32Array {
  const out = new Float32Array(a.length);
  out.fill(-Infinity);
  for (let angle = 0; angle < count; angle++) {
    const offsets = new Map<string, [number, number]>();
    for (let j = 0; j < 84; j++) {
      const t = -10 + (20 * j) / 83;
      const dy = evenRound(10 + t * Math.sin((angle * Math.PI) / count)) - 10;
      const dx = evenRound(10 + t * Math.cos((angle * Math.PI) / count)) - 10;
      offsets.set(`${dy},${dx}`, [dy, dx]);
    }
    const points = [...offsets.values()];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let v = 0;
        for (const [dy, dx] of points)
          if (y + dy >= 0 && y + dy < h && x + dx >= 0 && x + dx < w)
            v += a[(y + dy) * w + x + dx]!;
        out[y * w + x] = Math.max(out[y * w + x]!, v / points.length);
      }
  }
  return out;
}
/** Round through IEEE binary16, as v4 tile storage does. */
export function half(x: number): number {
  if (!Number.isFinite(x) || x === 0) return x;
  const sign = x < 0 ? -1 : 1,
    v = Math.abs(x);
  const step = 2 ** Math.max(-24, Math.floor(Math.log2(v)) - 10);
  const q = evenRound(v / step) * step;
  return sign * (q >= 65520 ? Infinity : q);
}
