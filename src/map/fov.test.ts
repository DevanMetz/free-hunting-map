import { expect, it } from 'vitest';
import { destination, bearingTo, wedge, dragTip, dragEdge } from './fov';
import { haversine } from './geo';
const origin: [number, number] = [-90, 44];
const fov = { bearing: 0, angle: 45, range: 25 };
it('draws a closed geodesic wedge with at least 16 segments in lng/lat order', () => {
  const ring = wedge(origin, fov);
  expect(ring.length).toBe(27);
  expect(ring[0]).toEqual(origin); expect(ring.at(-1)).toEqual(origin);
  expect(ring[1]![0]).toBeLessThan(origin[0]);
  for (const p of ring.slice(1, -1)) expect(haversine(origin, p)).toBeCloseTo(25, 0);
  expect(bearingTo(origin, ring[13]!)).toBeCloseTo(0, 1);
});
it('rotates/resizes tip and clamps edge widths, including north wrap and cardinal directions', () => {
  expect(dragTip(origin, destination(origin, 90, 50), fov)).toMatchObject({ bearing: expect.closeTo(90, 0), range: expect.closeTo(50, 0) });
  expect(dragTip(origin, destination(origin, 180, 300), fov).range).toBe(100);
  expect(dragTip(origin, origin, fov).range).toBe(3);
  expect(dragEdge(origin, destination(origin, 350, 25), fov).angle).toBeCloseTo(20, 0);
  expect(dragEdge(origin, destination(origin, 180, 25), fov).angle).toBe(120);
  expect(dragEdge(origin, destination(origin, 0, 25), fov).angle).toBe(10);
});
