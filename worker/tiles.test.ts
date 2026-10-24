import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { gzipSync } from 'node:zlib';
import worker, { type Env } from './index';
import { decodeDirectory, tileId } from './pmtiles';

const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'tiles', modules: true, script: 'export default {fetch(){return new Response("ok")}}', compatibilityDate: '2026-10-13', r2Buckets: ['TILES'] }] }));
let bucket: R2Bucket;
const origin = 'https://freehuntingmap.com';
const tileBytes = Uint8Array.from([0x1a, 0x08, 0x0a, 0x06, ...new TextEncoder().encode('trails')]);
const secondTile = Uint8Array.from([0x1a, 0x04, 0x0a, 0x02, 0x6f, 0x6b]);
const PART_SIZE = 73; // Every section crosses real R2 part boundaries.
const sha = 'a'.repeat(64);
const varint = (value: number) => {
  const bytes: number[] = [];
  do { const digit = value % 128; value = Math.floor(value / 128); bytes.push(digit | (value ? 128 : 0)); } while (value);
  return bytes;
};
function directory(entries: { id: number; run: number; length: number; offset: number }[]) {
  let lastId = 0;
  return Uint8Array.from([
    ...varint(entries.length), ...entries.flatMap(entry => { const delta = entry.id - lastId; lastId = entry.id; return varint(delta); }),
    ...entries.flatMap(entry => varint(entry.run)), ...entries.flatMap(entry => varint(entry.length)),
    ...entries.flatMap((entry, i) => varint(i && entry.offset === entries[i - 1]!.offset + entries[i - 1]!.length ? 0 : entry.offset + 1)),
  ]);
}
function fixture(leaf: boolean, gzip: boolean) {
  const compress = (bytes: Uint8Array) => gzip ? new Uint8Array(gzipSync(bytes)) : bytes;
  const a = compress(tileBytes), b = compress(secondTile);
  // IDs 1 & 2 share a run; ID 3 is absent; ID 4 uses contiguous-offset encoding.
  const entries = [{ id: 1, run: 2, length: a.length, offset: 0 }, { id: 4, run: 1, length: b.length, offset: a.length }];
  const leaves = leaf ? compress(directory(entries)) : new Uint8Array();
  const root = compress(directory(leaf ? [{ id: 1, run: 0, length: leaves.length, offset: 0 }] : entries));
  const metadata = compress(new TextEncoder().encode('{"vector_layers":[{"id":"trails","fields":{}}]}'));
  const bytes = new Uint8Array(127 + root.length + metadata.length + leaves.length + a.length + b.length);
  bytes.set(new TextEncoder().encode('PMTiles')); bytes[7] = 3;
  const view = new DataView(bytes.buffer);
  const u64 = (offset: number, value: number) => view.setBigUint64(offset, BigInt(value), true);
  u64(8, 127); u64(16, root.length); u64(24, 127 + root.length); u64(32, metadata.length);
  u64(40, 127 + root.length + metadata.length); u64(48, leaves.length);
  const tileOffset = 127 + root.length + metadata.length + leaves.length;
  u64(56, tileOffset); u64(64, a.length + b.length); u64(72, 3); u64(80, 2); u64(88, 2);
  bytes[96] = 1; bytes[97] = gzip ? 2 : 1; bytes[98] = gzip ? 2 : 1; bytes[99] = 1; bytes[100] = 0; bytes[101] = 14;
  bytes.set(root, 127); bytes.set(metadata, 127 + root.length); bytes.set(leaves, 127 + root.length + metadata.length);
  bytes.set(a, tileOffset); bytes.set(b, tileOffset + a.length);
  return bytes;
}
async function upload(bytes: Uint8Array) {
  await bucket.put('trails/v1/manifest.json', JSON.stringify({ size: bytes.length, partSize: PART_SIZE, parts: Math.ceil(bytes.length / PART_SIZE), sha256: sha, built: '2026-10-24', bounds: [-125, 24, -66, 50] }));
  for (let i = 0; i * PART_SIZE < bytes.length; i++) await bucket.put(`trails/v1/part-${String(i).padStart(3, '0')}`, bytes.slice(i * PART_SIZE, (i + 1) * PART_SIZE));
  // A new binding identity simulates a fresh isolate, avoiding cached previous fixtures.
  return new Proxy(bucket, { get(target, key) { const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value; } });
}
const env = (TILES?: R2Bucket) => ({ TILES, ASSETS: { fetch: async () => new Response('SPA') } }) as Env;
const call = (path: string, TILES?: R2Bucket, init?: RequestInit) => worker.fetch(new Request(origin + path, init), env(TILES));
beforeAll(async () => { bucket = await mf.getR2Bucket('TILES', 'tiles') as unknown as R2Bucket; });
afterEach(() => vi.unstubAllGlobals());
afterAll(() => mf.dispose());

describe('trail archive routes with real R2 and synthetic PMTiles', () => {
  it('streams full archives, HEAD, suffix/open ranges and ranges spanning parts', async () => {
    const bytes = fixture(true, true), binding = await upload(bytes);
    const full = await call('/tiles/trails/v1.pmtiles', binding);
    expect(full.status).toBe(200); expect(full.headers.get('ETag')).toBe(`"${sha}"`);
    expect(full.headers.get('Accept-Ranges')).toBe('bytes');
    expect(new Uint8Array(await full.arrayBuffer())).toEqual(bytes);
    const head = await call('/tiles/trails/v1.pmtiles', binding, { method: 'HEAD' });
    expect(head.headers.get('Content-Length')).toBe(String(bytes.length)); expect(await head.text()).toBe('');
    for (const [range, offset, end] of [['bytes=60-160', 60, 160], ['bytes=70-', 70, bytes.length - 1], ['bytes=-10', bytes.length - 10, bytes.length - 1], ['bytes=0-99999', 0, bytes.length - 1]] as const) {
      const response = await call('/tiles/trails/v1.pmtiles', binding, { headers: { Range: range } });
      expect(response.status).toBe(206); expect(response.headers.get('Content-Range')).toBe(`bytes ${offset}-${end}/${bytes.length}`);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes.slice(offset, end + 1));
    }
    const partialHead = await call('/tiles/trails/v1.pmtiles', binding, { method: 'HEAD', headers: { Range: 'bytes=60-160' } });
    expect(partialHead.status).toBe(206); expect(await partialHead.text()).toBe('');
    for (const range of ['bytes=5-4', 'bytes=-0', `bytes=${bytes.length}-`, 'bytes=0-1,4-5', 'bad', 'bytes=9007199254740992-']) {
      const response = await call('/tiles/trails/v1.pmtiles', binding, { headers: { Range: range } });
      expect(response.status).toBe(416); expect(response.headers.get('Content-Range')).toBe(`bytes */${bytes.length}`);
    }
    expect((await call('/tiles/trails/v1.pmtiles', binding, { headers: { 'If-None-Match': `W/"${sha}"` } })).status).toBe(304);
    expect((await call('/tiles/trails/v1.pmtiles', binding, { headers: { Range: 'bytes=0-1', 'If-Range': '"old"' } })).status).toBe(200);
  });

  it.each([[false, false], [true, false], [false, true], [true, true]])('extracts tiles: leaf=%s, gzip=%s', async (leaf, gzip) => {
    const binding = await upload(fixture(leaf, gzip));
    const get = vi.spyOn(binding, 'get');
    for (const [x, y] of [[0, 0], [0, 1]]) {
      const response = await call(`/tiles/trails/v1/1/${x}/${y}.mvt`, binding);
      expect(response.status).toBe(200); expect(response.headers.get('Content-Type')).toBe('application/vnd.mapbox-vector-tile');
      expect(response.headers.get('Content-Encoding')).toBeNull();
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(tileBytes);
    }
    // Header and directories were cached; the second lookup reads only tile parts.
    const reads = get.mock.calls.length;
    expect(new Uint8Array(await (await call('/tiles/trails/v1/1/1/0.mvt', binding)).arrayBuffer())).toEqual(secondTile);
    expect(get.mock.calls.length - reads).toBeLessThanOrEqual(2);
    const missing = await call('/tiles/trails/v1/1/1/1.mvt', binding);
    expect(missing.status).toBe(204); expect(await missing.text()).toBe('');
    const head = await call('/tiles/trails/v1/1/0/0.mvt', binding, { method: 'HEAD' });
    expect(head.status).toBe(200); expect(await head.text()).toBe('');
    expect((await call('/tiles/trails/v1/15/0/0.mvt', binding)).status).toBe(204);
    expect((await call('/tiles/trails/v1/27/0/0.mvt', binding)).status).toBe(400);
    expect((await call('/tiles/trails/v1/1/2/0.mvt', binding)).status).toBe(400);
    expect((await call('/tiles/trails/v1/1/0/0.mvt', binding, { method: 'POST' })).status).toBe(405);
    expect(await (await call('/tiles/trails/v1.json', binding)).json()).toMatchObject({ minzoom: 6, maxzoom: 14, vector_layers: [{ id: 'trails' }], bounds: [-125, 24, -66, 50] });
    get.mockRestore();
  });

  it('uses Cache API for present and absent tiles, with conditional GET and HEAD', async () => {
    const binding = await upload(fixture(true, true));
    const saved = new Map<string, Response>();
    const cache = { match: vi.fn(async (request: Request) => saved.get(request.url)?.clone()), put: vi.fn(async (request: Request, response: Response) => { saved.set(request.url, response); }) };
    vi.stubGlobal('caches', { default: cache });
    const response = await call('/tiles/trails/v1/1/0/0.mvt', binding);
    expect(cache.put).toHaveBeenCalledOnce();
    const get = vi.spyOn(binding, 'get');
    expect(await (await call('/tiles/trails/v1/1/0/0.mvt', binding)).arrayBuffer()).toEqual(await response.arrayBuffer());
    expect((await call('/tiles/trails/v1/1/0/0.mvt', binding, { headers: { 'If-None-Match': response.headers.get('ETag')! } })).status).toBe(304);
    expect(await (await call('/tiles/trails/v1/1/0/0.mvt', binding, { method: 'HEAD' })).text()).toBe('');
    expect(get).not.toHaveBeenCalled();
    expect((await call('/tiles/trails/v1/1/1/1.mvt', binding)).status).toBe(204);
    expect((await call('/tiles/trails/v1/1/1/1.mvt', binding)).status).toBe(204);
    expect(cache.put).toHaveBeenCalledTimes(2);
    get.mockRestore();
  });

  it('never serves the SPA for tiles and retries missing manifests', async () => {
    expect((await call('/tiles/unknown')).status).toBe(404);
    const response = await call('/tiles/trails/v1/1/0/0.mvt');
    expect(response.status).toBe(503); expect(response.headers.get('Cache-Control')).toBe('no-store');
    const get = vi.fn(async () => null);
    const binding = { get } as unknown as R2Bucket;
    expect((await call('/tiles/trails/v1/1/0/0.mvt', binding)).status).toBe(503);
    expect((await call('/tiles/trails/v1/1/0/0.mvt', binding)).status).toBe(503);
    expect(get).toHaveBeenCalledTimes(2);
  });
});

it('maps known Hilbert coordinates and decodes large varints without 32-bit truncation', () => {
  for (const [z, x, y, id] of [[0, 0, 0, 0], [1, 0, 0, 1], [1, 0, 1, 2], [1, 1, 1, 3], [1, 1, 0, 4], [2, 0, 0, 5], [12, 3423, 1763, 19078479]]) expect(tileId(z!, x!, y!)).toBe(id);
  const entries = [{ id: 2 ** 40, run: 3, length: 50, offset: 2 ** 35 }, { id: 2 ** 40 + 4, run: 1, length: 10, offset: 2 ** 35 + 50 }];
  expect(decodeDirectory(directory(entries))).toEqual(entries);
  expect(() => decodeDirectory(Uint8Array.from([1, 128]))).toThrow();
});
