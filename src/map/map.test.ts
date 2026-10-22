import { describe, expect, it, vi } from 'vitest';
import type { LayerSpecification } from 'maplibre-gl';
import { PUBLIC_LANDS, publicLandDefaults } from './publicLands';
import { HuntMap, type MapState } from './map';

vi.mock('maplibre-gl', () => ({ setWorkerUrl: vi.fn() }));

describe('hillshade overlay', () => {
  it.each(['topo', 'satellite', 'streets'] as const)('preserves ordering and visibility across %s style reloads', async (basemap) => {
    const state: MapState = { basemap, hillshade: true, parcels: true, water: true, deerUnits: true, publicLand: publicLandDefaults(true), labels: true, labelScale: 1 };
    let layers: LayerSpecification[] = [];
    const sources = new Map();
    const resetStyle = () => {
      sources.clear();
      layers = basemap === 'streets'
        ? [{ id: 'land', type: 'background' }, { id: 'roads', type: 'line', source: 'streets' }, { id: 'names', type: 'symbol', source: 'streets' }]
        : [{ id: 'basemap', type: 'raster', source: 'basemap' }];
    };
    resetStyle();
    const map = {
      getSource: (id: string) => sources.get(id),
      addSource: (id: string, source: unknown) => sources.set(id, { ...source as object, setData: vi.fn() }),
      getStyle: () => ({ layers }),
      addLayer: (layer: LayerSpecification, before?: string) => {
        const index = layers.findIndex((entry) => entry.id === before);
        layers.splice(index < 0 ? layers.length : index, 0, layer);
      },
      hasImage: () => true,
      getLayer: (id: string) => layers.find((layer) => layer.id === id),
      setLayoutProperty: vi.fn(),
    };
    // Exercise the real style lifecycle without a WebGL context.
    const hunt = Object.assign(Object.create(HuntMap.prototype), {
      map, state, parcelLoader: { setEnabled: vi.fn() }, items: [], sketch: { line: [], color: '#ffd54f' },
    }) as Pick<HuntMap, 'setHillshade' | 'mapState'> & { installOverlays(): Promise<void> };
    for (let reload = 0; reload < 2; reload++) {
      await hunt.installOverlays();
      const ids = layers.map((layer) => layer.id);
      const overlays = ['hillshade', 'water-nhd', 'water-nwi', ...PUBLIC_LANDS.map(({ id }) => `padus-${id}`), 'parcels-fill', 'parcels-line', 'deer-units', basemap === 'streets' ? 'roads' : 'ohm-roads-transportation', 'ohm-tracks'];
      const present = overlays.filter(id => ids.includes(id));
      expect(present.map(id => ids.indexOf(id))).toEqual(present.map(id => ids.indexOf(id)).sort((a, b) => a - b));
      expect(map.getLayer('parcels-line')).toMatchObject({ minzoom: 13, paint: { 'line-color': basemap === 'satellite' ? '#ffd400' : '#b0306a' } });
      expect(ids.indexOf('hillshade')).toBeLessThan(ids.indexOf('ohm-tracks'));
      if (basemap === 'streets') {
        expect(ids.indexOf('hillshade')).toBeLessThan(ids.indexOf('roads'));
        expect(ids.indexOf('hillshade')).toBeLessThan(ids.indexOf('names'));
      }
      expect(map.getLayer('hillshade')).toMatchObject({
        paint: { 'raster-opacity': basemap === 'satellite' ? 0.45 : 0.55 },
        layout: { visibility: 'visible' },
      });
      for (const category of PUBLIC_LANDS) {
        expect(map.getLayer(`padus-${category.id}`)).toMatchObject({ minzoom: 5, layout: { visibility: 'visible' } });
        expect(sources.get(`padus-${category.id}`)).toMatchObject({ tileSize: 256, minzoom: 5 });
      }
      expect(map.getLayer('padus')).toBeUndefined();
      expect(sources.get('hillshade')).toMatchObject({ tileSize: 256, minzoom: 11, maxzoom: 17 });
      resetStyle();
    }
    hunt.setHillshade(false);
    expect(hunt.mapState.hillshade).toBe(false);
    await hunt.installOverlays();
    expect(map.getLayer('hillshade')?.layout).toMatchObject({ visibility: 'none' });
    hunt.setHillshade(true);
    expect(map.setLayoutProperty).toHaveBeenLastCalledWith('hillshade', 'visibility', 'visible');
  });
});
