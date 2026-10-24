import { describe, expect, it } from 'vitest';
import { pixelValue, rasterClasses, rasterTiles, IIPP_CACHE, LANDFIRE_CACHE } from './raster';

describe('raster service parsing', () => {
  it('rejects nodata, missing values, RGB strings and non-finite pixels without losing zero', () => {
    for (const value of [null, undefined, '', 'NoData', '1, 2, 3', NaN, Infinity, {}, ' ']) expect(pixelValue(value)).toBeNull();
    expect(pixelValue('0')).toBe(0);
    expect(pixelValue('7239')).toBe(7239);
    expect(pixelValue(-9999)).toBe(-9999);
  });
  it('reads full attribute tables and discards malformed and background entries', () => {
    expect([...rasterClasses({ features: [
      { attributes: { Value: 7239, EVT_NAME: 'Northern pine-oak forest' } },
      { attributes: { Value: '7301', EVT_NAME: 'Aspen-birch forest' } },
      { attributes: { Value: -9999, EVT_NAME: 'Fill-NoData' } },
      { attributes: { Value: 0, EVT_NAME: 'Background' } },
      { attributes: { Value: 1, EVT_NAME: 42 } }, null,
    ] }, 'EVT_NAME')]).toEqual([[7239, 'Northern pine-oak forest'], [7301, 'Aspen-birch forest']]);
    expect(rasterClasses({ error: {} }, 'Name').size).toBe(0);
  });
  it('preserves MapLibre bbox templates, rendering rules, dates and transparent nodata', () => {
    const url = rasterTiles('https://example.com/ImageServer', { time: '1735689600000', noData: '0,254,255', renderingRule: '{"rasterFunction":"canopy"}' });
    expect(url).toContain('bbox={bbox-epsg-3857}');
    const params = new URL(url).searchParams;
    expect(params.get('format')).toBe('png32');
    expect(params.get('time')).toBe('1735689600000');
    expect(params.get('noData')).toBe('0,254,255');
    expect(params.get('renderingRule')).toBe('{"rasterFunction":"canopy"}');
    expect(params.get('interpolation')).toBe('RSP_NearestNeighbor');
  });
  it('caches viewed imagery and attribute tables without caching live identify', () => {
    const bases = [
      ['https://imagery.geoplatform.gov/iipp/rest/services/Vegetation/USFS_EDW_NLCD_TCC_CONUS/ImageServer', IIPP_CACHE],
      ['https://lfps.usgs.gov/arcgis/rest/services/Landfire_LF2024/LF2024_EVT_CONUS/ImageServer', LANDFIRE_CACHE],
    ] as const;
    for (const [base, pattern] of bases) {
      expect(pattern.test(rasterTiles(base))).toBe(true);
      expect(pattern.test(`${base}/rasterAttributeTable?f=json`)).toBe(true);
      expect(pattern.test(`${base}/identify?f=json`)).toBe(false);
    }
  });
});

it('identifies the displayed crop mosaic and caches its complete class table', async () => {
  const { rasterIdentify } = await import('./raster');
  const { vi } = await import('vitest');
  const requests: URL[] = [];
  const controller = new AbortController();
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    expect(init.signal).toBe(controller.signal);
    requests.push(new URL(url));
    return new Response(JSON.stringify(url.includes('/identify?') ? { value: '143' } : {
      features: [{ attributes: { Value: 143, Class_Name: 'Mixed Forest' } }],
    }));
  });
  try {
    const identify = rasterIdentify('https://example.com/CDL/ImageServer', 'Crops', 'Crop', {
      mosaicRule: '{"where":"Year = 2025"}', time: '1735689600000', renderingRule: '{"rasterFunction":"croptypes"}',
    }, { rasterFunction: 'croptypes', nameField: 'Class_Name' }, '2025');
    expect(await identify(-90.8, 44.5, controller.signal)).toEqual({ title: 'Crops', rows: [['Crop', 'Mixed Forest'], ['Year', '2025']] });
    await identify(-90.9, 44.6, controller.signal);
    expect(requests.filter(url => url.pathname.endsWith('/rasterAttributeTable'))).toHaveLength(1);
    for (const url of requests.filter(url => url.pathname.endsWith('/identify'))) {
      expect(url.searchParams.get('mosaicRule')).toBe('{"where":"Year = 2025"}');
      expect(url.searchParams.get('time')).toBe('1735689600000');
      expect(url.searchParams.get('renderingRule')).toBe('{"rasterFunction":"None"}');
    }
  } finally { vi.unstubAllGlobals(); }
});
