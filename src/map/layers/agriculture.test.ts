import { expect, it, vi } from 'vitest';
import { layerRegistry } from '../layerRegistry';
import './agriculture';

it('uses the croptypes function table field rather than the differently named raw CDL table field', async () => {
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.includes('/identify?')) expect(JSON.parse(new URL(url).searchParams.get('pixelSize')!)).toEqual({
      x: 10, y: 10, spatialReference: { wkid: 3857 },
    });
    return new Response(JSON.stringify(url.includes('/identify?') ? { value: '1' } : {
      features: [{ attributes: { Value: 1, Class_Name: 'Corn' } }],
    }));
  });
  try {
    const def = layerRegistry.get('cropland')!;
    const tile = new URL(def.source!.tiles[0]!);
    expect(tile.searchParams.get('mosaicRule')).toBe('{"where":"Year = 2025"}');
    expect(await def.identify!(-90.8, 44.5, new AbortController().signal, {} as never, [0, 0])).toEqual({
      title: 'Crops', rows: [['Crop', 'Corn'], ['Year', '2025']],
    });
  } finally { vi.unstubAllGlobals(); }
});
