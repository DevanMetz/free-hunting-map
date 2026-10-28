import { ASPECT_EXPORT, CUTS_TILES, DEER_EXPORT, HILLSHADE_EXPORT, LIDAR_BOUNDS, LIDAR_TILES, NHD_TILES, NWI_EXPORT, SLOPE_EXPORT, TRAILS_TILES, USGS_IMAGERY_TILES, USGS_TOPO_TILES, WATER_HISTORY_TILES, roadTiles, type BasemapId } from '../map/sources';
import { PUBLIC_LANDS, publicLandExportUrl } from '../map/publicLands';
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
      const tileX = (x % n + n) % n;
      // Match MapLibre's EPSG:3857 tile bounding box exactly for runtime-cache hits.
      const halfWorld = 20037508.342789244;
      const extent = 2 * halfWorld / n;
      const row = n - y - 1;
      const bbox = `${-halfWorld + tileX * extent},${-halfWorld + row * extent},${-halfWorld + (tileX + 1) * extent},${-halfWorld + (row + 1) * extent}`;
      urls.push(template.replace('{z}', String(z)).replace('{x}', String(tileX)).replace('{y}', String(y)).replace('{bbox-epsg-3857}', bbox));
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
    h('option', { value: 'water-history' }, 'Surface water history'),
    h('option', { value: 'wetlands' }, 'Wetlands'),
    ...PUBLIC_LANDS.map(land => h('option', { value: `land-${land.id}` }, land.label)),
    h('option', { value: 'deer' }, 'Wisconsin deer units'),
    h('option', { value: 'hillshade' }, 'Hillshade'),
    h('option', { value: 'slope' }, 'Slope'),
    h('option', { value: 'aspect' }, 'Aspect'),
    h('option', { value: 'lidar-lrm' }, 'Local relief'),
    h('option', { value: 'lidar-openness' }, 'Openness'),
    h('option', { value: 'lidar-hillshade' }, 'Lidar hillshade'),
    h('option', { value: 'lidar-slope' }, 'Lidar slope'),
    h('option', { value: 'lidar-chm' }, 'Canopy height'),
    h('option', { value: 'cuts' }, 'Logging cuts'),
    h('option', { value: 'census' }, 'Census 4WD roads'),
    h('option', { value: 'osm' }, 'OSM tracks'),
    h('option', { value: 'county' }, 'County forest roads'),
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
    const lidarNames: Record<string, string> = { 'lidar-lrm': 'Local relief', 'lidar-openness': 'Openness', 'lidar-hillshade': 'Lidar hillshade', 'lidar-slope': 'Lidar slope', 'lidar-chm': 'Canopy height' };
    const lidarName = lidarNames[source.value];
    const bounds = getBounds();
    if (lidarName && (bounds.getEast() < LIDAR_BOUNDS[0] || bounds.getWest() > LIDAR_BOUNDS[2] || bounds.getNorth() < LIDAR_BOUNDS[1] || bounds.getSouth() > LIDAR_BOUNDS[3])) {
      status.textContent = 'Move the map to the lidar coverage area.'; return;
    }
    const land = PUBLIC_LANDS.find(item => source.value === `land-${item.id}`);
    const choice = lidarName ? { name: lidarName, template: LIDAR_TILES[source.value]!, min: 8, max: source.value === 'lidar-chm' ? 15 : 16 }
      : land ? { name: land.label, template: publicLandExportUrl(land), min: 5, max: 16 }
      : source.value === 'deer' ? { name: 'Wisconsin deer units', template: DEER_EXPORT, min: 6, max: 16 }
      : source.value === 'trails' ? { name: 'Public trails', template: TRAILS_TILES, min: 6, max: 14 }
      : source.value === 'water' ? { name: 'Streams & lakes', template: NHD_TILES, min: 0, max: 16 }
      : source.value === 'water-history' ? { name: 'Surface water history', template: WATER_HISTORY_TILES, min: 0, max: 13 }
      : source.value === 'wetlands' ? { name: 'Wetlands', template: NWI_EXPORT, min: 11, max: 16 }
      : source.value === 'hillshade' ? { name: 'Hillshade', template: HILLSHADE_EXPORT, min: 11, max: 17 }
      : source.value === 'slope' ? { name: 'Slope', template: SLOPE_EXPORT, min: 10, max: 17 }
      : source.value === 'aspect' ? { name: 'Aspect', template: ASPECT_EXPORT, min: 11, max: 17 }
      : source.value === 'cuts' ? { name: 'Logging cuts', template: CUTS_TILES, min: 5, max: 13 }
      : source.value === 'census' ? { name: 'Census 4WD roads', template: roadTiles('tiger-trails', 'v2'), min: 8, max: 14 }
      : source.value === 'osm' ? { name: 'OSM tracks', template: roadTiles('osm-tracks', 'v2'), min: 8, max: 14 }
      : source.value === 'county' ? { name: 'County forest roads', template: roadTiles('wi-forest-roads', 'v1'), min: 8, max: 14 }
      : source.value === 'closed' ? { name: 'Closed forest roads', template: roadTiles('usfs-closed-roads', 'v1'), min: 8, max: 14 }
      : { name: basemap === 'topo' ? 'Topo' : 'Satellite', template: basemap === 'topo' ? USGS_TOPO_TILES : USGS_IMAGERY_TILES, min: 0, max: 16 };
    const urls = tiles(bounds, choice.min, Math.min(Number(zoom.value), choice.max), choice.template);
    if (!urls) { status.textContent = 'Area too large. Zoom in or choose less detail.'; return; }
    if (source.value === 'water-history' && urls.length > 200) { status.textContent = 'Area too large. Zoom in or choose less detail.'; return; }
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
