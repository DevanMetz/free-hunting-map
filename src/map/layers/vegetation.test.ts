import { expect, it } from 'vitest';
import { nlcdIdentifyResult } from './vegetation';
import { layerRegistry } from '../layerRegistry';

it('identifies WMS palette values with the displayed NLCD vintage', () => {
  expect(nlcdIdentifyResult({ features: [{ properties: { PALETTE_INDEX: 43 } }] })).toEqual({
    title: 'Land cover', rows: [['Cover', 'Mixed forest'], ['Year', '2025']],
  });
  for (const data of [{}, { features: [] }, { features: [{ properties: { PALETTE_INDEX: 0 } }] }, { features: [{ properties: { PALETTE_INDEX: null } }] }]) expect(nlcdIdentifyResult(data)).toBeNull();
});
it('caches Annual NLCD images but keeps GetFeatureInfo live', () => {
  const def = layerRegistry.get('land-cover')!;
  expect(def.cacheRoute!.test(def.source!.tiles[0]!)).toBe(true);
  expect(def.cacheRoute!.test(def.source!.tiles[0]!.replace('request=GetMap', 'request=GetFeatureInfo'))).toBe(false);
});
