import { describe, expect, it } from 'vitest';
import { historicTopo } from './historicTopo';

describe('historic topo layer', () => {
  it('serves same-origin WebP eras in the terrain category', () => {
    expect(historicTopo.category).toBe('terrain');
    expect(historicTopo.variants!.map(v => v.id)).toEqual(['early', '1970s']);
    expect(historicTopo.variants![1]!.tiles).toEqual(['/tiles/topo-1970s/v1/{z}/{x}/{y}.webp']);
    expect(historicTopo.cacheRoute!.test('https://freehuntingmap.com/tiles/topo-early/v1/15/8117/11849.webp')).toBe(true);
    expect(historicTopo.attribution).toMatch(/USGS/);
  });
});
