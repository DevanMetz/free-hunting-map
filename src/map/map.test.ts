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
    map, state, categories: [], refreshVersion: 0, styleVersion: 0, styleReady: true, installed: new Set(), parcelLoader: { setEnabled: vi.fn() }, items: [], sketch: { line: [], color: '#ffd54f' },
  }) as Pick<HuntMap, 'setLayer' | 'setLayerOpacity' | 'mapState'> & { installOverlays(): Promise<void>; installed: Set<string> };
  await hunt.installOverlays();
  expect(sources.has('public-trails')).toBe(false); expect(sources.has('hillshade')).toBe(false); expect(sources.has('water-nhd')).toBe(false);
  hunt.setLayer('public-trails', true); hunt.setLayer('slope', true); hunt.setLayer('water-nwi', true); hunt.setLayer('padus-usfs', true); hunt.setLayer('parcels', true);
  const check = () => {
    const ids = layers.map(l => l.id);
    expect(sources.get('public-trails')).toMatchObject({ type: 'vector', maxzoom: 14 });
    expect(map.getLayer('public-trails-foot')).toMatchObject({ paint: { 'line-color': basemap === 'satellite' ? '#ffc857' : '#5c3a1c' } });
    const data = layerRegistry.layers().flatMap(d => d.layerIds ?? (d.source ? [d.id] : [])).filter(id => ids.includes(id));
    expect(data.map(id => ids.indexOf(id))).toEqual(data.map(id => ids.indexOf(id)).sort((a, b) => a - b));
    expect(ids.indexOf('slope')).toBeLessThan(ids.indexOf('ohm-tracks'));
    if (basemap === 'streets') expect(ids.indexOf('slope')).toBeLessThan(ids.indexOf('roads'));
    expect(map.getLayer('parcels-line')).toMatchObject({ paint: { 'line-color': basemap === 'satellite' ? '#ffd400' : '#b0306a' } });
  };
  check(); hunt.setLayerOpacity('public-trails', 0.4);
  expect(map.setPaintProperty).toHaveBeenCalledWith('public-trails-foot', 'line-opacity', 0.4);
  expect(map.setPaintProperty).toHaveBeenCalledWith('public-trails-mvum-casing', 'line-opacity', 0.4 * 0.95);
  hunt.setLayerOpacity('slope', 0.32); expect(map.setPaintProperty).toHaveBeenCalledWith('slope', 'raster-opacity', 0.32);
  reset(); (hunt as unknown as { installed: Set<string> }).installed.clear(); await hunt.installOverlays(); check();
  expect(map.setPaintProperty).toHaveBeenCalledWith('slope', 'raster-opacity', 0.32);
  hunt.setLayer('slope', false); expect(map.setLayoutProperty).toHaveBeenCalledWith('slope', 'visibility', 'none');
  reset(); hunt.installed.clear(); await hunt.installOverlays(); expect(sources.has('slope')).toBe(false);
  hunt.setLayer('public-trails', false);
  expect(map.setLayoutProperty).toHaveBeenCalledWith('public-trails-foot', 'visibility', 'none');
  reset(); hunt.installed.clear(); await hunt.installOverlays(); expect(sources.has('public-trails')).toBe(false);
  hunt.setLayer('my-items', false); expect(map.setLayoutProperty).toHaveBeenCalledWith('ohm-waypoints', 'visibility', 'none');
  expect(map.setLayoutProperty).toHaveBeenCalledWith('ohm-fov-fill', 'visibility', 'none');
  const copy = hunt.mapState; copy.layers.slope!.on = true; expect(hunt.mapState.layers.slope!.on).toBe(false);
});

it('removes hidden items from render and hit-test sources and colors camera wedges', async () => {
  const data = new Map<string, any>();
  const map = { getSource: (id: string) => ({ setData: (value: unknown) => data.set(id, value) }), hasImage: () => true };
  const category = { kind: 'category', id: 'category-123', name: 'North', color: '#123456', hidden: false, deleted: false };
  const cam = { kind: 'waypoint', id: 'camera-123', name: 'Camera', note: '', icon: 'trailcam', coord: [-90, 44], categoryId: category.id, fov: { bearing: 90, angle: 45, range: 25 }, deleted: false };
  const hunt = Object.assign(Object.create(HuntMap.prototype), { map, styleReady: true, styleVersion: 0, state: { showPins: true }, items: [cam], categories: [category], refreshVersion: 0 }) as unknown as Pick<HuntMap, 'setItems'> & { refreshItems(): Promise<void> };
  await hunt.refreshItems();
  expect(data.get('ohm-items-pt').features).toHaveLength(1);
  expect(data.get('ohm-fov').features[0].properties.color).toBe('#123456');
  expect(data.get('ohm-fov').features[0].geometry.coordinates[0]).toHaveLength(27);
  for (const hidden of ['item', 'category', 'type']) {
    Object.assign(hunt, { items: [{ ...cam, hidden: hidden === 'item' }], categories: [{ ...category, hidden: hidden === 'category' }], state: { showPins: hidden !== 'type' } });
    await hunt.refreshItems();
    expect(data.get('ohm-items-pt').features).toEqual([]);
    expect(data.get('ohm-fov').features).toEqual([]);
  }
});
