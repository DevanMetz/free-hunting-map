import { describe, it, expect } from "vitest";
import { gaussian, gradient, half, oriented, reflect, sato } from "./kernels";
import { downsample, fillGround, zoom2 } from "./features";
import { starts } from "./inference";
import { graphLines, skeletonize, simplify, calibrate } from "./postprocess";
import { checkedBox } from "./ept";
describe("v4 numerical kernels", () => {
  it("reflects with SciPy half-sample symmetry", () => {
    expect(Array.from({ length: 10 }, (_, i) => reflect(i - 3, 4))).toEqual([
      2, 1, 0, 0, 1, 2, 3, 3, 2, 1,
    ]);
  });
  it("preserves constants and planar gradients", () => {
    const a = new Float32Array(121).fill(12);
    expect(
      [...gaussian(a, 11, 11, 3)].every((v) => Math.abs(v - 12) < 1e-5),
    ).toBe(true);
    const ramp = Float32Array.from({ length: 121 }, (_, i) => i % 11);
    expect([...gradient(ramp, 11, 11, 1)]).toEqual(Array(121).fill(1));
  });
  it("has no Sato response on flat terrain", () => {
    const [v, r] = sato(new Float32Array(81).fill(5), 9, 9);
    expect(Math.max(...v, ...r)).toBeLessThan(1e-6);
  });
  it("aligns zoom endpoints and averages 0.5 m cells", () => {
    const z = zoom2(new Float32Array([1, 2, 3, 4]), 2, 2);
    expect(z[0]).toBe(1);
    expect(z[15]).toBe(4);
    expect([...downsample(z, 2, 2)]).toEqual([
      1.5, 2.1666665077209473, 2.8333332538604736, 3.5,
    ]);
  });
  it("preserves occupied ground cells and fallback on empty cells", () => {
    const sums = new Float64Array(16),
      counts = new Uint32Array(16);
    sums[0] = 40;
    counts[0] = 2;
    const a = fillGround(sums, counts, new Float32Array(4).fill(15), 2, 2);
    expect(a[0]).toBe(20);
    expect(a.every(Number.isFinite)).toBe(true);
    expect([
      ...fillGround(
        new Float64Array(16),
        new Uint32Array(16),
        new Float32Array(4).fill(15),
        2,
        2,
      ),
    ]).toEqual(Array(16).fill(15));
  });
  it("rounds through binary16 ties-to-even", () => {
    expect(half(1 + 1 / 2048)).toBe(1);
    expect(half(1 + 3 / 2048)).toBe(1 + 2 / 1024);
    expect(half(-0.3)).toBe(-0.300048828125);
  });
  it("uses zero padding for oriented filters", () => {
    const a = oriented(new Float32Array(31 * 31).fill(1), 31, 31, 12);
    expect(a[15 * 31 + 15]).toBe(1);
    expect(a[0]).toBeLessThan(1);
  });
  it("covers inference edges without duplicate windows", () => {
    expect(starts(1000)).toEqual([0, 384, 488]);
    expect(starts(256)).toEqual([0]);
  });
});
describe("v4 topology and bounds", () => {
  it("traces a straight skeleton without diagonal shortcuts", () => {
    const a = new Uint8Array(49);
    for (let x = 1; x < 6; x++) a[3 * 7 + x] = 1;
    expect(skeletonize(a, 7, 7)).toEqual(a);
    expect(graphLines(a, 7, 7)).toEqual([
      [
        [3, 1],
        [3, 2],
        [3, 3],
        [3, 4],
        [3, 5],
      ],
    ]);
    expect(
      simplify([
        [0, 0],
        [1, 0],
        [2, 0],
      ]),
    ).toEqual([
      [0, 0],
      [2, 0],
    ]);
  });
  it("clamps and interpolates frozen isotonic calibration", () => {
    const c = { x: [1, 2, 3], y: [0, 0.5, 1] };
    expect(calibrate(1.5, c)).toBe(0.25);
    expect(calibrate(-10, c)).toBe(0);
    expect(calibrate(5, c)).toBe(1);
  });
  it("rejects huge or invalid selections before allocation or network", () => {
    expect(() => checkedBox([-91, 44, -90, 45])).toThrow();
    expect(() => checkedBox([NaN, 44, -90, 45])).toThrow();
    expect(() => checkedBox([-90.83, 44.51, -90.82, 44.52])).not.toThrow();
  });
});
