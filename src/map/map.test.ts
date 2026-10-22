import { describe, expect, it, vi } from 'vitest';
import type { LayerSpecification } from 'maplibre-gl';
import { HuntMap, type MapState } from './map';

vi.mock('maplibre-gl', () => ({ setWorkerUrl: vi.fn() }));

describe('hillshade overlay', () => {
  it.each(['topo', 'satellite', 'streets'] as const)('preserves ordering and visibility across %s style reloads', async (basemap) => {
    const state: MapState = { basemap, hillshade: true, publicLands: true, labels: true, labelScale: 1 };
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
      map, state, items: [], sketch: { line: [], color: '#ffd54f' },
    }) as Pick<HuntMap, 'setHillshade' | 'mapState'> & { installOverlays(): Promise<void> };
    for (let reload = 0; reload < 2; reload++) {
      await hunt.installOverlays();
      const ids = layers.map((layer) => layer.id);
      expect(ids.indexOf('hillshade')).toBeLessThan(ids.indexOf('padus'));
      expect(ids.indexOf('hillshade')).toBeLessThan(ids.indexOf('ohm-tracks'));
      if (basemap === 'streets') {
        expect(ids.indexOf('hillshade')).toBeLessThan(ids.indexOf('roads'));
        expect(ids.indexOf('hillshade')).toBeLessThan(ids.indexOf('names'));
      }
      expect(map.getLayer('hillshade')).toMatchObject({
        paint: { 'raster-opacity': basemap === 'satellite' ? 0.45 : 0.55 },
        layout: { visibility: 'visible' },
      });
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
