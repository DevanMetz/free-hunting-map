import { expect, it, vi } from 'vitest';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import type { Map, LayerSpecification, SourceSpecification } from 'maplibre-gl';
import './osmTracks';
import { layerRegistry } from '../layerRegistry';

it('osm-tracks: registers, installs valid cased lines below labels and caches its archive', async () => {
  const def = layerRegistry.get('osm-tracks')!;
  expect(def).toMatchObject({ category: 'trails', minzoom: 10, cacheStrategy: 'CacheFirst', identifyPresentation: 'sheet' });
  expect(def.attribution).toContain('OpenStreetMap');
  expect(def.cacheRoute!.test('https://freehuntingmap.com/tiles/osm-tracks/v2/12/1/2.mvt')).toBe(true);
  expect(def.cacheRoute!.test('https://freehuntingmap.com/tiles/other/v1/12/1/2.mvt')).toBe(false);
  const sources: Record<string, SourceSpecification> = {};
  const layers: LayerSpecification[] = [];
  const map = {
    getSource: (id: string) => sources[id],
    addSource: (id: string, source: SourceSpecification) => { sources[id] = source; },
    getLayer: (id: string) => layers.find(layer => layer.id === id),
    addLayer: vi.fn((layer: LayerSpecification, _before?: string) => { layers.push(layer); }),
    setLayoutProperty: vi.fn(), setPaintProperty: vi.fn(),
    queryRenderedFeatures: vi.fn(() => [{ properties: {"g": 3, "s": "gravel", "a": "private", "n": "Test road", "id": 123}, geometry: { type: 'LineString', coordinates: [[0, 0], [10, 0]] } }]),
    project: (p: number[]) => ({ x: p[0]!, y: p[1]! }),
  };
  const ctx = { basemap: 'topo' as const, beforeId: 'labels', setParcelsEnabled: vi.fn() };
  for (const basemap of ['topo', 'satellite'] as const) {
    layers.length = 0;
    def.install!(map as unknown as Map, { ...ctx, basemap });
    expect(validateStyleMin({ version: 8, sources, layers })).toEqual([]);
    expect(layers.every(layer => 'source-layer' in layer && layer['source-layer'] === 'osm')).toBe(true);
  }
  expect(sources[def.id]).toMatchObject({ type: 'vector', minzoom: 8, maxzoom: 14, attribution: def.attribution, tiles: ['/tiles/osm-tracks/v2/{z}/{x}/{y}.mvt'] });
  expect(layers.map(layer => layer.id)).toEqual(def.layerIds);
  for (const call of map.addLayer.mock.calls) expect(call[1]).toBe('labels');
  const installed = layers.length;
  def.install!(map as unknown as Map, ctx);
  expect(layers).toHaveLength(installed);
  const filters = JSON.stringify(layers.map(layer => 'filter' in layer ? layer.filter : null));
  expect(filters).toContain("\"g\"");
  expect(filters).toContain("1");
  expect(filters).toContain("2");
  expect(filters).toContain("3");
  expect(filters).toContain("4");
  expect(filters).toContain("5");
  const grade = (key: string) => layers.find(layer => layer.id === `osm-tracks-${key}`) as import('maplibre-gl').LineLayerSpecification;
  expect(grade('grade1').paint?.['line-dasharray']).toBeUndefined();
  expect(grade('grade2').paint?.['line-dasharray']).toBeUndefined();
  for (const key of ['grade3', 'grade4', 'unknown']) expect(grade(key).paint?.['line-dasharray']).toEqual([3, 2]);
  expect(grade('grade5').paint?.['line-dasharray']).toEqual([0.5, 2]);
  def.setVisible!(map as unknown as Map, false, ctx);
  def.setOpacity!(map as unknown as Map, 0.4, ctx);
  for (const id of def.layerIds!) {
    expect(map.setLayoutProperty).toHaveBeenCalledWith(id, 'visibility', 'none');
    expect(map.setPaintProperty).toHaveBeenCalledWith(id, 'line-opacity', id.endsWith('-casing') ? 0.34 : 0.4);
  }
  const result = await def.identify!(0, 0, new AbortController().signal, map as unknown as Map, [5, 0]);
  expect(result?.title).toBe('Test road');
  expect(result?.rows.length).toBeGreaterThan(1);
  expect(result?.links).toEqual([{ label: 'OpenStreetMap', url: 'https://www.openstreetmap.org/way/123' }]);
  expect((def.legend as { label: string }[]).map(c => c.label)).toEqual(['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Unknown']);
  map.queryRenderedFeatures.mockReturnValue([]);
  expect(await def.identify!(0, 0, new AbortController().signal, map as unknown as Map, [5, 0])).toBeNull();
});
