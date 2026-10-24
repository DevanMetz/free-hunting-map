import { describe, expect, it } from 'vitest';
import { CACHE_ROUTES } from './cacheRoutes';
import { HILLSHADE_EXPORT } from './sources';

describe('CACHE_ROUTES', () => {
  it('caches 3DEP hillshade exports without matching other services', () => {
    expect(CACHE_ROUTES.hillshade.test(HILLSHADE_EXPORT.replace('{bbox-epsg-3857}', '-1000,-1000,1000,1000'))).toBe(true);
    expect(CACHE_ROUTES.hillshade.test('https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer?f=json')).toBe(false);
    expect(CACHE_ROUTES.hillshade.test('https://example.com/arcgis/rest/services/3DEPElevation/ImageServer/exportImage')).toBe(false);
  });

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

it('caches parcel, water and deer imagery while keeping DNR identification live', async () => {
  const { PARCELS_QUERY, NHD_TILES, NWI_EXPORT, DEER_EXPORT, DEER_SERVICE } = await import('./sources');
  expect(CACHE_ROUTES.parcels.test(PARCELS_QUERY + '?where=1%3D1')).toBe(true);
  expect(CACHE_ROUTES.nhd.test(NHD_TILES)).toBe(true);
  expect(CACHE_ROUTES.nwi.test(NWI_EXPORT)).toBe(true);
  expect(CACHE_ROUTES.deer.test(DEER_EXPORT)).toBe(true);
  expect(Object.values(CACHE_ROUTES).some(pattern => pattern.test(DEER_SERVICE + '/2/query?f=json'))).toBe(false);
});
