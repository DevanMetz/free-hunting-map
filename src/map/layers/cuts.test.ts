import { expect, it } from 'vitest';
import '../builtinLayers';
import { layerRegistry } from '../layerRegistry';
import { CUTS_ATTR, CUTS_BOUNDS, CUTS_TILES } from '../sources';

it('registers lower-48 logging cuts with year colors and offline raster caching', () => {
  const def = layerRegistry.get('logging-cuts')!;
  expect(def.name).toBe('Logging cuts');
  expect(def.category).toBe('vegetation');
  expect(def.defaultOn).toBeUndefined();
  expect(def.source).toEqual({ kind: 'raster', tiles: [CUTS_TILES], tileSize: 256, minzoom: 5, maxzoom: 13, bounds: CUTS_BOUNDS });
  expect(def.attribution).toBe(CUTS_ATTR);
  expect(def.attribution).toContain('CC BY 4.0');
  expect(def.legend).toEqual(expect.arrayContaining([expect.objectContaining({ label: '2001' }), expect.objectContaining({ label: '2025' })]));
  expect(layerRegistry.cacheRoutes()).toContain(def.cacheRoute);
  expect(def.cacheStrategy).toBe('CacheFirst');
  expect(def.cacheRoute!.test('https://freehuntingmap.com/tiles/cuts/v1/12/1014/1480.webp')).toBe(true);
  for (const path of ['/tiles/cuts/v1.json', '/tiles/cuts/v1.pmtiles', '/tiles/trails/v2/12/1014/1480.mvt']) {
    expect(def.cacheRoute!.test(`https://freehuntingmap.com${path}`)).toBe(false);
  }
});
