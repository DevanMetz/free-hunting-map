import { PMTiles } from './pmtiles';
import { openTileArchive } from './tileArchive';

type Archive = { ext: 'mvt' | 'webp'; contentType: string; title: string; attribution: string; minzoom: number; maxzoom: number; layer?: string };
const vector = (title: string, attribution: string, layer: string, minzoom = 8, maxzoom = 14): Archive => ({ ext: 'mvt', contentType: 'application/vnd.mapbox-vector-tile', title, attribution, minzoom, maxzoom, layer });
const raster = (title: string, attribution: string, minzoom = 8, maxzoom = 16): Archive => ({ ext: 'webp', contentType: 'image/webp', title, attribution, minzoom, maxzoom });
const ARCHIVES: Record<string, Archive> = {
  cuts: raster('Logging cuts', '<a href="https://developers.google.com/earth-engine/datasets/catalog/UMD_hansen_global_forest_change_2025_v1_13">Hansen/UMD/Google/USGS/NASA Global Forest Change, CC BY 4.0</a>', 5, 13),
  trails: vector('Public trails', 'USFS, BLM, NPS, USGS trails (public domain)', 'trails', 6, 14),
  'tiger-trails': vector('Census 4WD roads', 'U.S. Census Bureau TIGER/Line (public domain)', 'tiger'),
  'usfs-closed-roads': vector('Closed forest roads', 'USDA Forest Service (public domain)', 'usfs'),
  'osm-tracks': vector('OSM tracks', '© OpenStreetMap contributors (ODbL)', 'osm'),
  'wi-forest-roads': vector('County forest roads', 'Wisconsin county forests', 'wiforest'),
  ...Object.fromEntries(['lidar-lrm', 'lidar-openness', 'lidar-hillshade', 'lidar-slope', 'lidar-chm'].map(name => [name, raster(name, 'USGS 3DEP lidar')])),
  'topo-early': raster('Historic topos 1924–1958', 'USGS Historical Topographic Map Collection (public domain)', 9, 15),
  'topo-1970s': raster('Historic topos 1969–1984', 'USGS Historical Topographic Map Collection (public domain)', 10, 16),
};
const IMMUTABLE = 'public, max-age=31536000, immutable';
const LIDAR = /^lidar-(?:lrm|openness|hillshade|slope|chm)$/;
/** Lidar v2+ is published as one archive per z9 tile (`<name>/<version>/b9-<x>-<y>/`) so coverage grows block by block. */
export const BLOCK_ZOOM = 9;
const blocked = (name: string, version: string) => LIDAR.test(name) && version !== 'v1';
const SHORT = 'public, max-age=600';
const readers = new WeakMap<R2Bucket, Map<string, Promise<PMTiles | null>>>();
async function reader(bucket: R2Bucket, name: string, version: string): Promise<PMTiles | null> {
  const key = `${name}/${version}`;
  let byVersion = readers.get(bucket);
  if (!byVersion) readers.set(bucket, byVersion = new Map());
  const versions = byVersion;
  let pending = versions.get(key);
  if (!pending) {
    pending = openTileArchive(bucket, version, name).then(archive => {
      if (!archive) versions.delete(key); // Uploads may still be in progress.
      return archive ? new PMTiles(archive, ARCHIVES[name]!.ext === 'mvt' ? 1 : 4) : null;
    }).catch(error => { versions.delete(key); throw error; });
    versions.set(key, pending);
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
  const route = /^\/tiles\/([^/]+)\/(v[1-9]\d{0,3})(?:\/(\d+)\/(\d+)\/(\d+)\.(mvt|webp)|\.pmtiles|\.json)$/.exec(url.pathname);
  const name = route?.[1] ?? '';
  const archive = Object.hasOwn(ARCHIVES, name) ? ARCHIVES[name] : undefined;
  if (!route || !archive || (route[6] && route[6] !== archive.ext)) return new Response('Not found', { status: 404 });
  const version = route[2]!;
  const tile = route[3] !== undefined ? route.slice(3, 6) : null;
  const raw = url.pathname.endsWith('.pmtiles');
  const tilejson = url.pathname.endsWith('.json');
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  const [z, x, y] = tile ? tile.map(Number) as [number, number, number] : [0, 0, 0];
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
  const headers0 = new Headers({ 'Cache-Control': SHORT });
  try {
    if (blocked(name, version) && !raw) {
      if (tilejson) {
        headers0.set('Content-Type', 'application/json');
        return new Response(request.method === 'HEAD' ? null : JSON.stringify({ tilejson: '3.0.0', name: archive.title, format: 'webp', tiles: [`${url.origin}/tiles/${name}/${version}/{z}/{x}/{y}.webp`], minzoom: BLOCK_ZOOM, maxzoom: archive.maxzoom, attribution: archive.attribution }), { headers: headers0 });
      }
      if (z < BLOCK_ZOOM) return new Response(null, { status: 204, headers: headers0 });
      const shift = z - BLOCK_ZOOM;
      // Blocks not yet published fall back to the v1 (Clark County) archive.
      const pm = bucket ? await reader(bucket, name, `${version}/b${BLOCK_ZOOM}-${x >>> shift}-${y >>> shift}`) ?? await reader(bucket, name, 'v1') : null;
      const bytes = pm ? await pm.tile(z, x, y) : null;
      if (!pm || pm.archive.prefix.endsWith('/v1/')) {
        // Not cached at the edge: the block may land later.
        headers0.set('Content-Type', archive.contentType);
        return new Response(request.method === 'HEAD' || !bytes ? null : new Uint8Array(bytes).buffer, { status: bytes ? 200 : 204, headers: headers0 });
      }
      return await finishTile(request, pm, bytes, archive, `${z}-${x}-${y}`, cache, cacheKey, ctx);
    }
    if (blocked(name, version)) return new Response('Not found', { status: 404 });
    const pm = bucket ? await reader(bucket, name, version) : null;
    if (!pm) return new Response(archive.ext === 'mvt' ? 'Trails unavailable' : 'Terrain unavailable', { status: 503, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' } });
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
      return new Response(request.method === 'HEAD' ? null : JSON.stringify({ tilejson: '3.0.0', name: archive.title, ...(archive.ext === 'webp' ? { format: 'webp' } : {}), tiles: [`${url.origin}/tiles/${name}/${version}/{z}/{x}/{y}.${archive.ext}`], minzoom: archive.minzoom, maxzoom: archive.maxzoom, bounds: manifest.bounds, attribution: archive.attribution, ...(archive.layer ? { vector_layers: [{ id: archive.layer, fields: name === 'trails' ? { type: 'String', src: 'String', agency: 'String' } : {} }] } : {}) }), { headers });
    }
    return await finishTile(request, pm, await pm.tile(z, x, y), archive, `${z}-${x}-${y}`, cache, cacheKey, ctx);
  } catch (error) {
    console.error('Tile request failed', error);
    return new Response(archive.ext === 'mvt' ? 'Trails unavailable' : 'Terrain unavailable', { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } });
  }
}

async function finishTile(request: Request, pm: PMTiles, bytes: Uint8Array | null, archive: Archive, id: string, cache: Cache | undefined, cacheKey: Request, ctx?: Pick<ExecutionContext, 'waitUntil'>): Promise<Response> {
  const etag = `"${pm.archive.manifest.sha256}-${id}"`;
  const headers = new Headers({ 'Cache-Control': IMMUTABLE, ETag: etag, 'Content-Type': archive.contentType });
  if (unchanged(request, etag)) return new Response(null, { status: 304, headers });
  const response = new Response(bytes ? new Uint8Array(bytes).buffer : null, { status: bytes ? 200 : 204, headers });
  if (cache && request.method === 'GET') {
    const put = cache.put(cacheKey, response.clone());
    if (ctx) ctx.waitUntil(put); else await put;
  }
  return request.method === 'HEAD' ? new Response(null, { status: response.status, headers }) : response;
}
