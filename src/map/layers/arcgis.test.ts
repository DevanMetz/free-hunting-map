import { expect, it } from 'vitest';
import { queryGeometry } from './arcgis';
it('keeps exact point intersection for polygon layers without a tap tolerance', () => {
  expect(queryGeometry(-90.81941, 44.51971)).toEqual({ geometry: '-90.81941,44.51971', geometryType: 'esriGeometryPoint' });
  for (const distance of [0, -1, Infinity, NaN]) expect(queryGeometry(-90, 44, distance).geometryType).toBe('esriGeometryPoint');
});
it('converts meter tolerance to a small indexed search envelope accounting for latitude', () => {
  const equator = queryGeometry(0, 0, 111_320);
  expect(equator).toEqual({ geometry: '-1,-1,1,1', geometryType: 'esriGeometryEnvelope' });
  const [west, south, east, north] = queryGeometry(-90, 60, 111_320).geometry.split(',').map(Number);
  expect(west).toBeCloseTo(-92); expect(east).toBeCloseTo(-88);
  expect(south).toBe(59); expect(north).toBe(61);
  const edge = queryGeometry(180, 89.9, 100_000).geometry.split(',').map(Number);
  expect(edge[2]).toBe(180); expect(edge[3]).toBe(90);
});
