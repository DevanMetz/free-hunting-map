import { expect, it } from 'vitest';
import { contourContent, ecoregionContent, elevationContent, soilContent, soilQuery } from './terrain';
import { layerRegistry } from '../layerRegistry';
it('parses SDA rows with missing values without interpreting hydric percentages as ratings', () => {
  expect(soilContent({ Table: [['Tarr sand', 'Excessively drained', 'No', 'Not prime farmland']] })).toEqual({
    title: 'Tarr sand', rows: [['Drainage', 'Excessively drained'], ['Hydric (dominant)', 'No'], ['Farmland', 'Not prime farmland']],
  });
  expect(soilContent({ Table: [['Water', null, null, null]] })).toEqual({ title: 'Water', rows: [] });
  for (const value of [null, {}, { Table: [] }, { Table: ['error'] }, { Table: [[null]] }]) expect(soilContent(value)).toBeNull();
});
it('uses longitude first for soil intersection and rejects invalid coordinates', () => {
  expect(soilQuery(-90.81941, 44.51971)).toContain("POINT(-90.81941 44.51971)");
  expect(soilQuery(-90, 44)).toContain('ORDER BY c.comppct_r DESC, c.cokey');
  for (const [lng, lat] of [[NaN, 0], [181, 0], [0, 91], [Infinity, 0]]) expect(() => soilQuery(lng!, lat!)).toThrow(RangeError);
});
it('names both ecoregion levels, keeping the level-IV parent region', () => {
  expect(ecoregionContent({ US_L3NAME: 'North Central Hardwood Forests', US_L3CODE: '51' }, 3)?.rows).toContainEqual(['Region', 'North Central Hardwood Forests']);
  expect(ecoregionContent({ US_L4NAME: 'Sand Plain', US_L4CODE: '51c', US_L3NAME: 'Hardwood Forests' }, 4)?.rows).toContainEqual(['Level III', 'Hardwood Forests']);
  expect(ecoregionContent({}, 4)).toBeNull();
});
it('recognizes contour units from raw field names or identify aliases', () => {
  expect(contourContent({ contourelevation: 1100, contourunits: 1 })?.rows).toEqual([['Elevation', '1,100 ft']]);
  expect(contourContent({ CONTOURELEVATION: '325', ContourUnits: 'Meters' })?.rows).toEqual([['Elevation', '325 m']]);
  expect(contourContent({ CONTOURELEVATION: 'bad' })).toBeNull();
  expect(contourContent({})).toBeNull();
});
it('rejects nodata and impossible elevations but preserves sea level and below-sea-level terrain', () => {
  expect(elevationContent('329.753')?.rows).toEqual([['Height', '330 m / 1,082 ft']]);
  expect(elevationContent('0')?.rows).toEqual([['Height', '0 m / 0 ft']]);
  expect(elevationContent(-80)).not.toBeNull();
  for (const value of [null, '', 'NoData', -999999, Infinity, {}]) expect(elevationContent(value)).toBeNull();
});
it('declares cache routes, legends and identify for all new terrain layers', () => {
  for (const id of ['soils-ssurgo', 'terrain-ecoregions-iii', 'terrain-ecoregions-iv', 'terrain-contours', 'terrain-elevation']) {
    const def = layerRegistry.get(id)!;
    expect(def.cacheRoute?.test(def.source!.tiles[0]!)).toBe(true);
    expect(def.legend).toBeDefined(); expect(def.identify).toBeTypeOf('function');
  }
});
