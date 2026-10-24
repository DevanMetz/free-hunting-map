import { expect, it } from 'vitest';
import '../builtinLayers';
import { layerRegistry } from '../layerRegistry';
import { riparianContent, waterContent, watershedContent } from './water';
it('names NHD point and line types with source field casing and missing names', () => {
  expect(waterContent({ GNIS_NAME: 'Veazie Springs', FTYPE: 458 })).toEqual({ title: 'Veazie Springs', rows: [['Type', 'Spring / seep']] });
  expect(waterContent({ gnis_name: 'Halls Creek', ftype: 460 })?.title).toBe('Halls Creek');
  expect(waterContent({ ftype: 390 })?.title).toBe('Lake / pond');
  expect(waterContent({})).toBeNull();
});
it('preserves HUC leading zeroes and hides absent fields', () => {
  expect(watershedContent({ name: 'East Fork Halls Creek', huc12: '070400070801' }, 12)?.rows).toEqual([['Name', 'East Fork Halls Creek'], ['HUC 12', '070400070801']]);
  expect(watershedContent({}, 10)).toBeNull();
});
it('never describes nodata or an unrecognized pixel as riparian', () => {
  expect(riparianContent('1')?.title).toBe('Riparian area');
  for (const value of ['NoData', '0', '', null, undefined, 255]) expect(riparianContent(value)).toBeNull();
});
it('adds identify to the existing NHD layer without duplicating its imagery', () => {
  expect(layerRegistry.get('water-nhd')?.identify).toBeTypeOf('function');
  expect(layerRegistry.layers().filter(d => d.id === 'water-nhd')).toHaveLength(1);
  for (const id of ['water-springs', 'water-huc10', 'water-huc12', 'water-riparian']) {
    const def = layerRegistry.get(id)!;
    expect(def.cacheRoute?.test(def.source!.tiles[0]!)).toBe(true);
    expect(def.identify).toBeTypeOf('function');
  }
});
