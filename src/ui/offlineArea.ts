import { CUTS_TILES, NHD_TILES, TRAILS_TILES, USGS_IMAGERY_TILES, USGS_TOPO_TILES, roadTiles, type BasemapId } from '../map/sources';
import type { LngLatBounds } from 'maplibre-gl';
import { h } from './dom';

const LIMIT = 2000;
const latY = (lat: number, n: number): number => {
  const rad = Math.max(-85.051129, Math.min(85.051129, lat)) * Math.PI / 180;
  return Math.floor((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2 * n);
};

/** Enumerate a bounded visible area, avoiding world-wrap duplicates. */
function tiles(bounds: LngLatBounds, minZoom: number, maxZoom: number, template: string): string[] | null {
  const urls: string[] = [];
  const west = bounds.getWest(), east = bounds.getEast();
  for (let z = minZoom; z <= maxZoom; z++) {
    const n = 2 ** z;
    const x0 = Math.floor((west + 180) / 360 * n);
    const x1 = Math.floor((east + 180) / 360 * n);
    const y0 = Math.max(0, latY(bounds.getNorth(), n));
    const y1 = Math.min(n - 1, latY(bounds.getSouth(), n));
    const xs = Math.min(n, x1 - x0 + 1);
    if (urls.length + xs * (y1 - y0 + 1) > LIMIT) return null;
    for (let x = x0; x < x0 + xs; x++) for (let y = y0; y <= y1; y++) {
      urls.push(template.replace('{z}', String(z)).replace('{x}', String((x % n + n) % n)).replace('{y}', String(y)));
    }
  }
  return urls;
}

export function offlineArea(getBounds: () => LngLatBounds, getBasemap: () => BasemapId): { element: HTMLElement; close: () => void } {
  let controller: AbortController | undefined;
  const source = h('select', { 'aria-label': 'Download layer' },
    h('option', { value: 'basemap' }, 'Current basemap'),
    h('option', { value: 'trails' }, 'Public trails'),
    h('option', { value: 'water' }, 'Streams & lakes'),
    h('option', { value: 'cuts' }, 'Logging cuts'),
    h('option', { value: 'census' }, 'Census 4WD roads'),
    h('option', { value: 'osm' }, 'OSM tracks'),
    h('option', { value: 'closed' }, 'Closed forest roads'));
  const zoom = h('select', { 'aria-label': 'Download detail' }, ...[12, 13, 14, 15, 16].map(z => h('option', { value: z, ...(z === 14 ? { selected: true } : {}) }, `Zoom ${z}`)));
  const status = h('div', { role: 'status', class: 'offline-download-status' });
  const download = h('button', { type: 'button', class: 'btn', onclick: () => { void start(); } }, 'Download area');
  const cancel = h('button', { type: 'button', class: 'btn', hidden: true, onclick: () => controller?.abort() }, 'Cancel');
  async function start(): Promise<void> {
    const basemap = getBasemap();
    if (source.value === 'basemap' && basemap === 'streets') { status.textContent = 'Choose Topo or Satellite to download.'; return; }
    if (!navigator.serviceWorker?.controller) { status.textContent = 'Offline storage is not ready. Reload and try again.'; return; }
    if (!navigator.onLine) { status.textContent = 'Connect to download an area.'; return; }
    const choice = source.value === 'trails' ? { name: 'Public trails', template: TRAILS_TILES, min: 6, max: 14 }
      : source.value === 'water' ? { name: 'Streams & lakes', template: NHD_TILES, min: 0, max: 16 }
      : source.value === 'cuts' ? { name: 'Logging cuts', template: CUTS_TILES, min: 5, max: 13 }
      : source.value === 'census' ? { name: 'Census 4WD roads', template: roadTiles('tiger-trails', 'v2'), min: 8, max: 14 }
      : source.value === 'osm' ? { name: 'OSM tracks', template: roadTiles('osm-tracks', 'v2'), min: 8, max: 14 }
      : source.value === 'closed' ? { name: 'Closed forest roads', template: roadTiles('usfs-closed-roads', 'v1'), min: 8, max: 14 }
      : { name: basemap === 'topo' ? 'Topo' : 'Satellite', template: basemap === 'topo' ? USGS_TOPO_TILES : USGS_IMAGERY_TILES, min: 0, max: 16 };
    const urls = tiles(getBounds(), choice.min, Math.min(Number(zoom.value), choice.max), choice.template);
    if (!urls) { status.textContent = 'Area too large. Zoom in or choose less detail.'; return; }
    controller = new AbortController();
    const signal = controller.signal;
    download.disabled = true; zoom.disabled = true; source.disabled = true; cancel.hidden = false;
    let completed = 0, failed = 0, next = 0;
    status.textContent = `Downloading ${choice.name}: 0 / ${urls.length}`;
    const worker = async () => {
      while (!signal.aborted && next < urls.length) {
        const url = urls[next++]!;
        try { const response = await fetch(url, { signal }); if (!response.ok) failed++; }
        catch { if (!signal.aborted) failed++; }
        if (!signal.aborted) { completed++; status.textContent = `Downloading ${choice.name}: ${completed} / ${urls.length}`; }
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    status.textContent = signal.aborted ? `Canceled: ${completed} / ${urls.length}` : failed ? `Downloaded ${completed - failed} / ${urls.length}. ${failed} failed.` : `Downloaded ${choice.name}: ${completed} tiles`;
    controller = undefined; download.disabled = false; zoom.disabled = false; source.disabled = false; cancel.hidden = true;
  }
  return { element: h('section', { class: 'offline-download', 'aria-label': 'Offline maps' }, h('div', { class: 'offline-download-controls' }, source, zoom, download, cancel), status), close: () => controller?.abort() };
}
