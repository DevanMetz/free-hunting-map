import { describe, expect, it } from 'vitest';
import type { Feature } from 'geojson';
import { tileBounds, tilesForBounds, parcelQueryUrl, mergeParcelFeatures } from './parcels';

describe('parcels', () => {
  it('converts XYZ to geographic bounds', () => {
    const [w, s, e, n] = tileBounds(0, 0, 0);
    expect([w, e]).toEqual([-180, 180]);
    expect(n).toBeCloseTo(85.051129); expect(s).toBeCloseTo(-85.051129);
    expect(tileBounds(1, 1, 0)[0]).toBe(0);
  });
  it('selects intersecting tiles and caps large viewports at 64', () => {
    expect(tilesForBounds([-1, 1, 1, 2], 2)).toEqual([[1, 1], [2, 1]]);
    const tiles = tilesForBounds([-180, -85, 180, 85]);
    expect(tiles).toHaveLength(64); expect(new Set(tiles.map(String)).size).toBe(64);
    expect(tilesForBounds([179, -1, -179, 1], 2).map(t => t[0])).toContain(0);
  });
  it('uses stable parameter order, six decimal bounds and explicit paging', () => {
    const url = parcelQueryUrl(4000, 6000);
    expect(url).toBe(parcelQueryUrl(4000, 6000, 0));
    const params = new URL(url).searchParams;
    expect(params.get('geometry')).toMatch(/^-?\d+\.\d{6},-?\d+\.\d{6},-?\d+\.\d{6},-?\d+\.\d{6}$/);
    expect(params.get('orderByFields')).toBe('OBJECTID');
    expect(new URL(parcelQueryUrl(4000, 6000, 2000)).searchParams.get('resultOffset')).toBe('2000');
    expect([...params.keys()].slice(0, 3)).toEqual(['where', 'geometry', 'geometryType']);
  });
  it('deduplicates overlapping tile features by state or parcel ID', () => {
    const feature = (properties: object): Feature => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties });
    const a = feature({ STATEID: 'WI1', PARCELID: '1' }), b = feature({ PARCELID: '2' });
    expect(mergeParcelFeatures([[a, b], [a, b]]).features).toEqual([a, b]);
  });
});

it('loads four tiles concurrently, paginates, and pauses below zoom 13', async () => {
  const { vi } = await import('vitest');
  const { ParcelLoader } = await import('./parcels');
  vi.useFakeTimers();
  let zoom = 12;
  const setData = vi.fn();
  const events = new Map<string, () => void>();
  const map = {
    on: (event: string, callback: () => void) => events.set(event, callback),
    getZoom: () => zoom,
    getSource: () => ({ setData }),
    getBounds: () => ({ getWest: () => -91, getEast: () => -90.9, getSouth: () => 44, getNorth: () => 44.1 }),
  };
  const resolvers: ((value: unknown) => void)[] = [];
  const fetcher = vi.fn((_url: string) => new Promise(resolve => resolvers.push(resolve)));
  vi.stubGlobal('fetch', fetcher);
  try {
    const loader = new ParcelLoader(map as unknown as import('maplibre-gl').Map);
    loader.setEnabled(true);
    await vi.advanceTimersByTimeAsync(250);
    expect(fetcher).not.toHaveBeenCalled();
    zoom = 13; events.get('moveend')!();
    await vi.advanceTimersByTimeAsync(250);
    expect(fetcher).toHaveBeenCalledTimes(4);
    resolvers[0]!({ ok: true, json: async () => ({ type: 'FeatureCollection', features: [], properties: { exceededTransferLimit: true } }) });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(new URL(String(fetcher.mock.calls.at(-1)?.[0])).searchParams.get('resultOffset')).toBe('2000');
    loader.setEnabled(false);
    for (const resolve of resolvers) resolve({ ok: true, json: async () => ({ features: [] }) });
    await vi.advanceTimersByTimeAsync(500);
    expect(fetcher).toHaveBeenCalledTimes(5);
  } finally { vi.unstubAllGlobals(); vi.useRealTimers(); }
});
