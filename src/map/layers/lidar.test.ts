import { expect, it } from 'vitest';
import '../builtinLayers';
import { layerRegistry, layerVariant } from '../layerRegistry';
import { LIDAR_BOUNDS } from '../sources';
import { lidarLayers } from './lidar';
import { historicAerials } from './historicAerials';
import { loadSettings } from '../../ui/settings';
import { portablePreferences } from '../../sync/records';

it('registers bounded, versioned lidar rasters first in terrain with immutable caching', () => {
  const ids = layerRegistry.layers().map(d => d.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(layerRegistry.categories().find(c => c.id === 'terrain')?.layers.slice(0, lidarLayers.length)).toEqual(lidarLayers);
  for (const def of lidarLayers) {
    expect(def.source).toEqual({ kind: 'raster', tiles: [`/tiles/${def.id}/v1/{z}/{x}/{y}.webp`], tileSize: 256, minzoom: 8, maxzoom: def.id === 'lidar-chm' ? 15 : 16, bounds: LIDAR_BOUNDS });
    expect(def.cacheRoute?.test(`https://freehuntingmap.com/tiles/${def.id}/v1/12/100/200.webp`)).toBe(true);
    expect(def.cacheStrategy).toBe('CacheFirst');
    expect(def.defaultOn).toBeUndefined();
  }
  expect(layerRegistry.get('tree-canopy')).toBeDefined();
});
it('defines historic imagery years, URLs, bounds and offline routes', () => {
  expect(historicAerials.variants?.map(v => v.label)).toEqual(['2022', '2020', '2015', '2013', '2008', '2005']);
  expect(layerVariant(historicAerials)?.id).toBe('2005');
  expect(historicAerials.source?.bounds).toEqual([-92.89, 42.49, -86.25, 47.31]);
  for (const v of historicAerials.variants!) {
    const url = new URL(v.tiles[0]!);
    expect(url.pathname).toContain(`EN_Image_Basemap_${v.id}_Leaf_On/ImageServer/exportImage`);
    expect(url.searchParams.get('bbox')).toBe('{bbox-epsg-3857}');
    expect(url.searchParams.get('size')).toBe('256,256');
    expect(historicAerials.cacheRoute?.test(url.href)).toBe(true);
  }
});
it('preserves variants with local and portable preferences and defaults invalid years', () => {
  const layers = { 'historic-aerials': { on: true, opacity: 0.43, variant: '2022' } };
  expect(loadSettings({ layers }).layers['historic-aerials']).toEqual(layers['historic-aerials']);
  expect(portablePreferences({ layers }).layers).toEqual(layers);
  expect(loadSettings({ layers: { 'historic-aerials': { ...layers['historic-aerials'], variant: 'invalid' } } }).layers['historic-aerials']?.variant).toBe('2005');
});
