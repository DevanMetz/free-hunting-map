import { expect, it, vi } from 'vitest';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import type { Map, LayerSpecification, SourceSpecification } from 'maplibre-gl';
import './wiForestRoads';
import { layerRegistry } from '../layerRegistry';

it('county-forest-roads: registers, installs valid cased lines below labels and caches its archive', async () => {
  const def = layerRegistry.get('county-forest-roads')!;
  expect(def).toMatchObject({ category: 'trails', minzoom: 10, cacheStrategy: 'CacheFirst', identifyPresentation: 'sheet' });
  expect(def.attribution).toContain('Bayfield County');
  expect(def.cacheRoute!.test('https://freehuntingmap.com/tiles/wi-forest-roads/v1/12/1/2.mvt')).toBe(true);
  expect(def.cacheRoute!.test('https://freehuntingmap.com/tiles/other/v1/12/1/2.mvt')).toBe(false);
  const sources: Record<string, SourceSpecification> = {};
  const layers: LayerSpecification[] = [];
  const map = {
    getSource: (id: string) => sources[id],
    addSource: (id: string, source: SourceSpecification) => { sources[id] = source; },
    getLayer: (id: string) => layers.find(layer => layer.id === id),
    addLayer: vi.fn((layer: LayerSpecification, _before?: string) => { layers.push(layer); }),
    setLayoutProperty: vi.fn(), setPaintProperty: vi.fn(),
    queryRenderedFeatures: vi.fn(() => [{ properties: {"src": "bfroad", "n": "Test road", "t": "forest road", "o": "Bayfield County"}, geometry: { type: 'LineString', coordinates: [[0, 0], [10, 0]] } }]),
    project: (p: number[]) => ({ x: p[0]!, y: p[1]! }),
  };
  const ctx = { basemap: 'topo' as const, beforeId: 'labels', setParcelsEnabled: vi.fn() };
  for (const basemap of ['topo', 'satellite'] as const) {
    layers.length = 0;
    def.install!(map as unknown as Map, { ...ctx, basemap });
    expect(validateStyleMin({ version: 8, sources, layers })).toEqual([]);
    expect(layers.every(layer => 'source-layer' in layer && layer['source-layer'] === 'wiforest')).toBe(true);
  }
  expect(sources[def.id]).toMatchObject({ type: 'vector', minzoom: 8, maxzoom: 14, attribution: def.attribution, tiles: ['/tiles/wi-forest-roads/v1/{z}/{x}/{y}.mvt'] });
  expect(layers.map(layer => layer.id)).toEqual(def.layerIds);
  for (const call of map.addLayer.mock.calls) expect(call[1]).toBe('labels');
  const installed = layers.length;
  def.install!(map as unknown as Map, ctx);
  expect(layers).toHaveLength(installed);
  expect(layers.filter(layer => 'filter' in layer).map(layer => 'filter' in layer ? layer.filter : undefined)).toContainEqual(['==', ['get', 't'], 'forest road']);
  def.setVisible!(map as unknown as Map, false, ctx);
  def.setOpacity!(map as unknown as Map, 0.4, ctx);
  for (const id of def.layerIds!) {
    expect(map.setLayoutProperty).toHaveBeenCalledWith(id, 'visibility', 'none');
    expect(map.setPaintProperty).toHaveBeenCalledWith(id, 'line-opacity', id.endsWith('-casing') ? 0.34 : 0.4);
  }
  const result = await def.identify!(0, 0, new AbortController().signal, map as unknown as Map, [5, 0]);
  expect(result?.title).toBe('Test road');
  expect(result?.rows.length).toBeGreaterThan(1);
  expect(result?.rows).toContainEqual(['Owner/agency', 'Bayfield County']);
  map.queryRenderedFeatures.mockReturnValue([]);
  expect(await def.identify!(0, 0, new AbortController().signal, map as unknown as Map, [5, 0])).toBeNull();
});
