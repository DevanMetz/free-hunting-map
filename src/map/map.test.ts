import { expect, it, vi } from 'vitest';
import type { LayerSpecification } from 'maplibre-gl';
import { HuntMap } from './map';
import { loadSettings } from '../ui/settings';
import { layerRegistry } from './layerRegistry';
vi.mock('maplibre-gl', () => ({ setWorkerUrl: vi.fn() }));
it.each(['topo', 'satellite', 'streets'] as const)('lazily installs, orders, restores and adjusts registry layers on %s', async basemap => {
  const state = loadSettings({ basemap });
  let layers: LayerSpecification[] = [];
  const sources = new Map();
  const reset = () => {
    sources.clear();
    layers = basemap === 'streets'
      ? [{ id: 'land', type: 'background' }, { id: 'roads', type: 'line', source: 'streets' }, { id: 'names', type: 'symbol', source: 'streets' }]
      : [{ id: 'basemap', type: 'raster', source: 'basemap' }];
  };
  reset();
  const map = {
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, source: unknown) => sources.set(id, { ...source as object, setData: vi.fn() }),
    getStyle: () => ({ layers }),
    addLayer: (layer: LayerSpecification, before?: string) => {
      const index = layers.findIndex(l => l.id === before); layers.splice(index < 0 ? layers.length : index, 0, layer);
    },
    moveLayer: (id: string, before?: string) => {
      const layer = layers.find(l => l.id === id)!; layers = layers.filter(l => l.id !== id); map.addLayer(layer, before);
    },
    hasImage: () => true, getLayer: (id: string) => layers.find(l => l.id === id),
    setLayoutProperty: vi.fn(), setPaintProperty: vi.fn(),
  };
  const hunt = Object.assign(Object.create(HuntMap.prototype), {
    map, state, styleReady: true, installed: new Set(), parcelLoader: { setEnabled: vi.fn() }, items: [], sketch: { line: [], color: '#ffd54f' },
  }) as Pick<HuntMap, 'setLayer' | 'setLayerOpacity' | 'mapState'> & { installOverlays(): Promise<void>; installed: Set<string> };
  await hunt.installOverlays();
  expect(sources.has('hillshade')).toBe(false); expect(sources.has('water-nhd')).toBe(false);
  hunt.setLayer('slope', true); hunt.setLayer('water-nwi', true); hunt.setLayer('padus-usfs', true); hunt.setLayer('parcels', true);
  const check = () => {
    const ids = layers.map(l => l.id);
    const data = layerRegistry.layers().flatMap(d => d.layerIds ?? (d.source ? [d.id] : [])).filter(id => ids.includes(id));
    expect(data.map(id => ids.indexOf(id))).toEqual(data.map(id => ids.indexOf(id)).sort((a, b) => a - b));
    expect(ids.indexOf('slope')).toBeLessThan(ids.indexOf('ohm-tracks'));
    if (basemap === 'streets') expect(ids.indexOf('slope')).toBeLessThan(ids.indexOf('roads'));
    expect(map.getLayer('parcels-line')).toMatchObject({ paint: { 'line-color': basemap === 'satellite' ? '#ffd400' : '#b0306a' } });
  };
  check(); hunt.setLayerOpacity('slope', 0.32); expect(map.setPaintProperty).toHaveBeenCalledWith('slope', 'raster-opacity', 0.32);
  reset(); (hunt as unknown as { installed: Set<string> }).installed.clear(); await hunt.installOverlays(); check();
  expect(map.setPaintProperty).toHaveBeenCalledWith('slope', 'raster-opacity', 0.32);
  hunt.setLayer('slope', false); expect(map.setLayoutProperty).toHaveBeenCalledWith('slope', 'visibility', 'none');
  reset(); hunt.installed.clear(); await hunt.installOverlays(); expect(sources.has('slope')).toBe(false);
  hunt.setLayer('my-items', false); expect(map.setLayoutProperty).toHaveBeenCalledWith('ohm-waypoints', 'visibility', 'none');
  const copy = hunt.mapState; copy.layers.slope!.on = true; expect(hunt.mapState.layers.slope!.on).toBe(false);
});
