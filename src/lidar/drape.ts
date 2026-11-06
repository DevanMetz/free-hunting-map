import { Map } from 'maplibre-gl';
import proj4 from 'proj4';
import { basemapStyle, USGS_IMAGERY_TILES, USGS_TOPO_TILES, type BasemapId } from '../map/sources';

/** Basemap image covering a web-mercator rectangle, using the same tile URLs as the 2D map. */
export interface DrapeImage {
  canvas: HTMLCanvasElement;
  west: number;
  south: number;
  east: number;
  north: number;
}

const TILE = 256;

function lngLat(x: number, y: number): [number, number] {
  const [lng, lat] = proj4('EPSG:3857', 'EPSG:4326', [x, y]);
  return [lng!, lat!];
}

function mercator(lng: number, lat: number): [number, number] {
  const [x, y] = proj4('EPSG:4326', 'EPSG:3857', [lng, lat]);
  return [x!, y!];
}

function xyz(lng: number, lat: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom;
  const x = Math.floor((lng + 180) / 360 * n);
  const rad = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n);
  return { x, y };
}

function latFromRow(y: number, zoom: number): number {
  const n = Math.PI - 2 * Math.PI * y / 2 ** zoom;
  return 180 / Math.PI * Math.atan(Math.sinh(n));
}

function tileTemplate(basemap: BasemapId): string {
  return basemap === 'satellite' ? USGS_IMAGERY_TILES : USGS_TOPO_TILES;
}

function loadImage(url: string, signal: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    const fail = () => {
      signal.removeEventListener('abort', abort);
      reject(signal.aborted ? new DOMException('Aborted', 'AbortError') : new Error('Map tile failed'));
    };
    const abort = () => { image.src = ''; fail(); };
    signal.addEventListener('abort', abort, { once: true });
    image.onload = () => { signal.removeEventListener('abort', abort); resolve(image); };
    image.onerror = fail;
    image.src = url;
  });
}

async function captureStreets(west: number, south: number, east: number, north: number, signal: AbortSignal): Promise<DrapeImage> {
  const [lngW, latS] = lngLat(west, south);
  const [lngE, latN] = lngLat(east, north);
  const aspect = Math.max(0.25, (east - west) / Math.max(1, north - south));
  const width = 768;
  const height = Math.max(192, Math.round(width / aspect));
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:${height}px`;
  document.body.append(el);
  const map = new Map({
    container: el,
    style: basemapStyle('streets'),
    interactive: false,
    attributionControl: false,
    fadeDuration: 0,
    canvasContextAttributes: { preserveDrawingBuffer: true, antialias: false },
  });
  map.on('error', () => undefined);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('Map unavailable')), 12000);
      const abort = () => { window.clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
      signal.addEventListener('abort', abort, { once: true });
      map.once('load', () => {
        map.fitBounds([[lngW, latS], [lngE, latN]], { padding: 0, animate: false, duration: 0 });
        map.once('idle', () => {
          window.clearTimeout(timer);
          signal.removeEventListener('abort', abort);
          resolve();
        });
      });
    });
    const src = map.getCanvas();
    const canvas = document.createElement('canvas');
    canvas.width = src.width;
    canvas.height = src.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Map unavailable');
    ctx.drawImage(src, 0, 0);
    const bounds = map.getBounds();
    const [texWest, texSouth] = mercator(bounds.getWest(), bounds.getSouth());
    const [texEast, texNorth] = mercator(bounds.getEast(), bounds.getNorth());
    return { canvas, west: texWest, south: texSouth, east: texEast, north: texNorth };
  } finally {
    map.remove();
    el.remove();
  }
}

/** Stitch the current basemap across the terrain, using the same sources as the 2D map. */
export async function loadBasemap(west: number, south: number, east: number, north: number, basemap: BasemapId, signal: AbortSignal): Promise<DrapeImage> {
  if (basemap === 'streets') return captureStreets(west, south, east, north, signal);
  const [lngW, latS] = lngLat(west, south);
  const [lngE, latN] = lngLat(east, north);
  let zoom = 11;
  let x0 = 0, x1 = 0, y0 = 0, y1 = 0;
  const cover = (z: number) => {
    const nw = xyz(lngW, latN, z);
    const se = xyz(lngE, latS, z);
    return { x0: Math.min(nw.x, se.x), x1: Math.max(nw.x, se.x), y0: Math.min(nw.y, se.y), y1: Math.max(nw.y, se.y) };
  };
  ({ x0, x1, y0, y1 } = cover(11));
  for (let z = 16; z >= 11; z--) {
    const next = cover(z);
    if (next.x1 - next.x0 + 1 <= 4 && next.y1 - next.y0 + 1 <= 4) {
      zoom = z;
      ({ x0, x1, y0, y1 } = next);
      break;
    }
  }
  const template = tileTemplate(basemap);
  const canvas = document.createElement('canvas');
  canvas.width = (x1 - x0 + 1) * TILE;
  canvas.height = (y1 - y0 + 1) * TILE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Map unavailable');
  let drawn = 0;
  await Promise.all(Array.from({ length: (x1 - x0 + 1) * (y1 - y0 + 1) }, async (_, i) => {
    const cols = x1 - x0 + 1;
    const x = x0 + i % cols;
    const y = y0 + Math.floor(i / cols);
    const url = template.replace('{z}', String(zoom)).replace('{y}', String(y)).replace('{x}', String(x));
    try {
      const image = await loadImage(url, signal);
      ctx.drawImage(image, (x - x0) * TILE, (y - y0) * TILE, TILE, TILE);
      drawn++;
    } catch (err) {
      if (signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) throw err;
    }
  }));
  if (!drawn) throw new Error('Map unavailable');
  const n = 2 ** zoom;
  const [texWest] = mercator(x0 / n * 360 - 180, 0);
  const [texEast] = mercator((x1 + 1) / n * 360 - 180, 0);
  const [, texNorth] = mercator(0, latFromRow(y0, zoom));
  const [, texSouth] = mercator(0, latFromRow(y1 + 1, zoom));
  return { canvas, west: texWest, south: texSouth, east: texEast, north: texNorth };
}
