import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it, vi } from 'vitest';
import type { Map as MLMap } from 'maplibre-gl';
import { TRAIL_HIT_LAYERS, TRAILS_SOURCE, trailAt, trailDetails, trailLayers, trailsSource } from './trails';

describe('public trails', () => {
  it.each(['topo', 'satellite', 'streets'] as const)('has valid cased styles on %s with distinct classes and MVUM priority', basemap => {
    const layers = trailLayers(true, basemap);
    expect(validateStyleMin({ version: 8, sources: { [TRAILS_SOURCE]: trailsSource() }, layers })).toEqual([]);
    expect(trailsSource()).toMatchObject({ maxzoom: 14, tiles: ['/tiles/trails/v2/{z}/{x}/{y}.mvt'] });
    const byId = new Map(layers.map(layer => [layer.id, layer]));
    const line = (type: string) => byId.get(`public-trails-${type}`)!;
    expect(new Set(['foot', 'horse', 'bike', 'ohv', 'snow', 'road'].map(type => line(type).paint?.['line-color'])).size).toBe(6);
    expect(line('foot').paint?.['line-dasharray']).toBeDefined();
    expect(line('horse').paint?.['line-dasharray']).toBeDefined();
    expect(line('road').minzoom).toBe(11); expect(line('ohv').minzoom).toBe(8);
    for (const type of ['foot', 'horse', 'bike', 'snow']) expect(line(type).minzoom).toBe(9);
    expect(line('mvum').minzoom).toBe(8); expect(line('mvum').paint?.['line-dasharray']).toBeUndefined();
    expect(byId.get('public-trails-mvum-casing')?.paint?.['line-color']).toBe('#20271f');
    expect(layers.at(-1)?.id).toBe('public-trails-mvum');
    expect(trailLayers(false, basemap).every(layer => layer.layout?.visibility === 'none')).toBe(true);
  });

  it('uses a generous hit box and only queries installed trail lines', () => {
    const properties = { type: 'foot', name: 'Forest trail' };
    const queryRenderedFeatures = vi.fn(() => [{ properties }]);
    const map = { getLayer: (id: string) => TRAIL_HIT_LAYERS.includes(id) ? {} : undefined, queryRenderedFeatures } as unknown as MLMap;
    expect(trailAt(map, { x: 100, y: 150 })).toEqual(properties);
    expect(queryRenderedFeatures).toHaveBeenCalledWith([[84, 134], [116, 166]], { layers: TRAIL_HIT_LAYERS });
    expect(trailAt({ project: map.project, queryRenderedFeatures: map.queryRenderedFeatures, getLayer: () => undefined }, { x: 0, y: 0 })).toBeUndefined();
  });

  it('selects the nearest trail when parallel routes share the hit box', () => {
    const map = { getLayer: () => ({}), project: ([x, y]: number[]) => ({ x, y }), queryRenderedFeatures: () => [
      { properties: { name: 'Motor route' }, geometry: { type: 'LineString', coordinates: [[0, 110], [200, 110]] } },
      { properties: { name: 'Foot trail' }, geometry: { type: 'MultiLineString', coordinates: [[[0, 100], [200, 100]]] } },
    ] } as unknown as MLMap;
    expect(trailAt(map, { x: 100, y: 101 })?.name).toBe('Foot trail');
  });

  it('formats only present fields and keeps unknown source values', () => {
    expect(trailDetails({ type: 'ohv', src: 'usfs_mvum_trails', agency: 'USFS', unit: 'Chequamegon', name: ' Forest Loop ', uses: 'ATV, Motorcycle', seasons: '05/15–11/30', date: '2026-10-24' })).toEqual({
      title: 'Forest Loop', rows: [['Type', 'OHV trail'], ['Allowed uses', 'ATV, Motorcycle'], ['Seasons', '05/15–11/30'], ['Agency', 'USFS · Chequamegon'], ['Source', 'USFS MVUM trails · 2026-10-24']],
    });
    expect(trailDetails({ type: 'foot', uses: ' ', agency: 'NPS', src: 'custom', seasons: null })).toEqual({ title: 'Foot trail', rows: [['Type', 'Foot trail'], ['Agency', 'NPS'], ['Source', 'custom']] });
    expect(trailDetails({})).toEqual({ title: 'Public trails', rows: [] });
  });
});
