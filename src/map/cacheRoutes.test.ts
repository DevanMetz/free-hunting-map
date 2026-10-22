import { describe, expect, it } from 'vitest';
import { CACHE_ROUTES } from './cacheRoutes';

describe('CACHE_ROUTES', () => {
  it('caches OpenFreeMap tiles and glyphs as immutable', () => {
    expect(CACHE_ROUTES.openfreemapTiles.test('https://tiles.openfreemap.org/planet/20261018_080001_pt/14/2890/6200.pbf')).toBe(true);
    expect(CACHE_ROUTES.openfreemapTiles.test('https://tiles.openfreemap.org/fonts/Noto%20Sans%20Regular/0-255.pbf')).toBe(true);
    expect(CACHE_ROUTES.openfreemapTiles.test('https://tiles.openfreemap.org/planet')).toBe(false);
  });

  it('revalidates the TileJSON and styles', () => {
    expect(CACHE_ROUTES.openfreemapStyles.test('https://tiles.openfreemap.org/planet')).toBe(true);
    expect(CACHE_ROUTES.openfreemapStyles.test('https://tiles.openfreemap.org/styles/liberty')).toBe(true);
    expect(CACHE_ROUTES.openfreemapStyles.test('https://tiles.openfreemap.org/planet/20261018_080001_pt/1/0/0.pbf')).toBe(false);
  });
});
