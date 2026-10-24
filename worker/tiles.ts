import { PMTiles } from './pmtiles';
import { openTileArchive } from './tileArchive';

const IMMUTABLE = 'public, max-age=31536000, immutable';
const readers = new WeakMap<R2Bucket, Promise<PMTiles | null>>();
async function reader(bucket: R2Bucket): Promise<PMTiles | null> {
  let pending = readers.get(bucket);
  if (!pending) {
    pending = openTileArchive(bucket).then(archive => {
      if (!archive) readers.delete(bucket); // Uploads may still be in progress.
      return archive ? new PMTiles(archive) : null;
    }).catch(error => { readers.delete(bucket); throw error; });
    readers.set(bucket, pending);
  }
  return pending;
}

/** A single HTTP byte range, including open-ended and suffix forms. */
function byteRange(value: string, size: number): { offset: number; length: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  const first = match[1] ? Number(match[1]) : null;
  const last = match[2] ? Number(match[2]) : null;
  if ((first !== null && !Number.isSafeInteger(first)) || (last !== null && !Number.isSafeInteger(last))) return null;
  if (first === null) return last && last > 0 ? { offset: Math.max(0, size - last), length: Math.min(size, last) } : null;
  if (first >= size || (last !== null && last < first)) return null;
  return { offset: first, length: Math.min(last ?? size - 1, size - 1) - first + 1 };
}
function unchanged(request: Request, etag: string): boolean {
  return (request.headers.get('If-None-Match') ?? '').split(',').some(value => value.trim().replace(/^W\//, '') === etag || value.trim() === '*');
}

export async function serveTiles(request: Request, bucket?: R2Bucket, ctx?: Pick<ExecutionContext, 'waitUntil'>): Promise<Response> {
  const url = new URL(request.url);
  const tile = /^\/tiles\/trails\/v1\/(\d+)\/(\d+)\/(\d+)\.mvt$/.exec(url.pathname);
  const raw = url.pathname === '/tiles/trails/v1.pmtiles';
  const tilejson = url.pathname === '/tiles/trails/v1.json';
  if (!tile && !raw && !tilejson) return new Response('Not found', { status: 404 });
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  const [z, x, y] = tile ? tile.slice(1).map(Number) as [number, number, number] : [0, 0, 0];
  if (tile && (!Number.isInteger(z) || z > 26 || !Number.isInteger(x) || !Number.isInteger(y) || x >= 2 ** z || y >= 2 ** z)) return new Response('Invalid tile coordinate', { status: 400 });
  // Only tile GETs enter Cache API; never buffer a full archive there.
  const cache = typeof caches !== 'undefined' && 'default' in caches ? (caches as CacheStorage & { default: Cache }).default : undefined;
  const cacheKey = new Request(url.origin + url.pathname);
  if (tile && cache) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      if (unchanged(request, cached.headers.get('ETag') ?? '')) return new Response(null, { status: 304, headers: cached.headers });
      return request.method === 'HEAD' ? new Response(null, { status: cached.status, headers: cached.headers }) : cached;
    }
  }
  try {
    const pm = bucket ? await reader(bucket) : null;
    if (!pm) return new Response('Trails unavailable', { status: 503, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' } });
    const { manifest } = pm.archive;
    const etag = `"${manifest.sha256}${tile ? `-${z}-${x}-${y}` : tilejson ? '-json' : ''}"`;
    const headers = new Headers({ 'Cache-Control': IMMUTABLE, ETag: etag });
    if (raw) headers.set('Accept-Ranges', 'bytes');
    if (unchanged(request, etag)) return new Response(null, { status: 304, headers });
    if (raw) {
      headers.set('Content-Type', 'application/vnd.pmtiles');
      const range = request.headers.get('Range');
      const useRange = range && (!request.headers.has('If-Range') || request.headers.get('If-Range') === etag);
      const selected = useRange ? byteRange(range, manifest.size) : { offset: 0, length: manifest.size };
      if (!selected) {
        headers.set('Content-Range', `bytes */${manifest.size}`);
        return new Response(null, { status: 416, headers });
      }
      const { offset, length } = selected;
      headers.set('Content-Length', String(length));
      if (useRange) headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${manifest.size}`);
      return new Response(request.method === 'HEAD' ? null : pm.archive.stream(offset, length), { status: useRange ? 206 : 200, headers });
    }
    if (tilejson) {
      headers.set('Content-Type', 'application/json');
      return new Response(request.method === 'HEAD' ? null : JSON.stringify({ tilejson: '3.0.0', name: 'Public trails', tiles: [`${url.origin}/tiles/trails/v1/{z}/{x}/{y}.mvt`], minzoom: 6, maxzoom: 14, bounds: manifest.bounds, attribution: 'USFS, BLM, NPS, USGS trails (public domain)', vector_layers: [{ id: 'trails', fields: { type: 'String', src: 'String', agency: 'String' } }] }), { headers });
    }
    const bytes = await pm.tile(z, x, y);
    headers.set('Content-Type', 'application/vnd.mapbox-vector-tile');
    const response = new Response(bytes ? new Uint8Array(bytes).buffer : null, { status: bytes ? 200 : 204, headers });
    if (cache && request.method === 'GET') {
      const put = cache.put(cacheKey, response.clone());
      if (ctx) ctx.waitUntil(put); else await put;
    }
    return request.method === 'HEAD' ? new Response(null, { status: response.status, headers }) : response;
  } catch (error) {
    console.error('Tile request failed', error);
    return new Response('Trails unavailable', { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } });
  }
}
