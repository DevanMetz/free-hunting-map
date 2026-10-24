import { checkedBox, emptyStats, nodes, tileBounds, EPT_ROOT, PROJECTS, type Box } from './ept';

/** Exactly the padded 1 km tiles processed by the scanner (including repeat nodes). */
export function scanTiles(box: Box): [number, number][] {
  const bb = checkedBox(box), out: [number, number][] = [];
  for (let x = Math.floor((bb[0] - 64) / 1000); x <= Math.floor((bb[2] + 63) / 1000); x++)
    for (let y = Math.floor((bb[1] - 64) / 1000); y <= Math.floor((bb[3] + 63) / 1000); y++) out.push([x, y]);
  return out;
}
const sizes = new Map<string, Promise<number>>();
async function nodeSize(url: string, signal?: AbortSignal): Promise<number> {
  let pending = sizes.get(url);
  if (!pending) {
    pending = (async () => {
      const r = await fetch(url, { method: 'HEAD', signal });
      const size = Number(r.headers.get('content-length'));
      if (!r.ok || !Number.isSafeInteger(size) || size <= 0) throw new Error('Lidar size unavailable');
      return size;
    })();
    if (sizes.size >= 4096) sizes.delete(sizes.keys().next().value!);
    sizes.set(url, pending);
    void pending.catch(() => sizes.delete(url));
  }
  return pending;
}
/** Count each tile's downloads, even when neighboring tiles request the same node. */
export function downloadBytes(tiles: readonly (readonly number[])[], overhead = 0): number {
  return tiles.reduce((sum, sizes) => sum + sizes.reduce((a, b) => a + b, 0), overhead);
}
export async function estimateDownload(box: Box, signal?: AbortSignal): Promise<number> {
  const tiles = scanTiles(box); // Reject oversized boxes before any requests.
  const stats = emptyStats(), downloads: number[][] = [];
  for (const [tx, ty] of tiles) {
    // The scanner uses the second survey only where the primary lacks coverage.
    // Prefer primary survey sizes; empty primary tiles use the fallback survey.
    let project: string = PROJECTS[0], keys = await nodes(project, tileBounds(tx, ty), stats, signal);
    if (!keys.length) { project = PROJECTS[1]; keys = await nodes(project, tileBounds(tx, ty), stats, signal); }
    const lengths: number[] = [];
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(16, keys.length) }, async () => {
      while (next < keys.length) {
        const key = keys[next++]!;
        lengths.push(await nodeSize(`${EPT_ROOT}/${project}/ept-data/${key}.laz`, signal));
      }
    }));
    downloads.push(lengths);
  }
  // Each 1128² Float32 DEM is downloaded too; hierarchy bytes are measured above.
  return downloadBytes(downloads, stats.bytes + tiles.length * 1128 * 1128 * 4);
}
