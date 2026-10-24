import { describe, it, expect, vi } from 'vitest';
import { downloadBytes, estimateDownload, scanTiles } from './download';
import * as ept from './ept';
import { checkedBox, tileBounds } from './ept';
describe('download planning', () => {
  it('sums node sizes, retaining repeated downloads across tiles and overhead', () => {
    expect(downloadBytes([[100,200],[100,300]],50)).toBe(750);
    expect(downloadBytes([])).toBe(0);
  });
  it('selects every padded scan tile, including boundary tiles', () => {
    const box: [number,number,number,number] = [-90.825,44.515,-90.815,44.525];
    const bb = checkedBox(box), tiles = scanTiles(box);
    expect(tiles.length).toBeGreaterThan(1);
    expect(tiles[0]).toEqual([Math.floor((bb[0]-64)/1000),Math.floor((bb[1]-64)/1000)]);
    const last = tiles.at(-1)!;
    expect(last).toEqual([Math.floor((bb[2]+63)/1000),Math.floor((bb[3]+63)/1000)]);
    expect(tileBounds(...last)).toEqual([last[0]*1000-64,last[1]*1000-64,last[0]*1000+1064,last[1]*1000+1064]);
  });
  it('queries node sizes and counts shared nodes for every scan tile', async () => {
    const box: [number,number,number,number] = [-90.825,44.515,-90.815,44.525];
    const hierarchy = vi.spyOn(ept, 'nodes').mockResolvedValue(['shared', 'leaf']);
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      expect(init?.method).toBe('HEAD');
      return new Response(null, { headers: { 'content-length': String(String(url).includes('shared') ? 1000000 : 2000000) } });
    });
    try {
      const count = scanTiles(box).length;
      expect(await estimateDownload(box)).toBe(count * (3000000 + 1128*1128*4));
      expect(hierarchy).toHaveBeenCalledTimes(count);
      expect(fetch).toHaveBeenCalledTimes(2);
      await estimateDownload(box);
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally { hierarchy.mockRestore(); fetch.mockRestore(); }
  });
  it('rejects oversized selections without any network requests', async () => {
    const fetch = vi.spyOn(globalThis,'fetch');
    await expect(estimateDownload([-120,20,-60,60])).rejects.toThrow('1 square mile');
    expect(fetch).not.toHaveBeenCalled(); fetch.mockRestore();
  });
});
