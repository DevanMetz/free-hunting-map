import { LAYER_CATEGORIES, layerRegistry, type LayerDef } from '../map/layerRegistry';
import { TRAILS_TILES, USGS_IMAGERY_TILES, USGS_TOPO_TILES, roadTiles, type BasemapId } from '../map/sources';
import type { Repo } from '../storage/repo';
import type { LngLatBounds } from 'maplibre-gl';
import { h, iconButton } from './dom';

const LIMIT = 2000;
const AREAS = 'offline.areas';
const latY = (lat: number, n: number): number => {
  const rad = Math.max(-85.051129, Math.min(85.051129, lat)) * Math.PI / 180;
  return Math.floor((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2 * n);
};

interface Box { west: number; south: number; east: number; north: number }
interface Pack { id: string; name: string; template: string; min: number; max: number; bounds?: [number, number, number, number]; cap?: number }
interface SavedArea extends Box { id: string; name: string; template: string; min: number; max: number }

const VECTOR_PACKS: Record<string, { template: string; min: number; max: number }> = {
  'public-trails': { template: TRAILS_TILES, min: 6, max: 14 },
  'census-4wd': { template: roadTiles('tiger-trails', 'v2'), min: 8, max: 14 },
  'osm-tracks': { template: roadTiles('osm-tracks', 'v2'), min: 8, max: 14 },
  'county-forest-roads': { template: roadTiles('wi-forest-roads', 'v1'), min: 8, max: 14 },
  'usfs-closed-roads': { template: roadTiles('usfs-closed-roads', 'v1'), min: 8, max: 14 },
};

/** Enumerate a bounded visible area, avoiding world-wrap duplicates. */
function tiles(bounds: Box, minZoom: number, maxZoom: number, template: string): string[] | null {
  const urls: string[] = [];
  const west = bounds.west, east = bounds.east;
  for (let z = minZoom; z <= maxZoom; z++) {
    const n = 2 ** z;
    const x0 = Math.floor((west + 180) / 360 * n);
    const x1 = Math.floor((east + 180) / 360 * n);
    const y0 = Math.max(0, latY(bounds.north, n));
    const y1 = Math.min(n - 1, latY(bounds.south, n));
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

function tileTemplate(url: string | undefined): string | null {
  if (!url || !/^(\/|https:\/\/)/.test(url) || !/\{(?:z|x|bbox-epsg-3857)\}/.test(url)) return null;
  return url;
}

function zooms(def: LayerDef): { min: number; max: number } {
  const source = def.source?.kind === 'raster' ? def.source : undefined;
  return { min: source?.minzoom ?? def.minzoom ?? 0, max: source?.maxzoom ?? 16 };
}

/** Stable tile layers only. Live feature queries are not a repeatable tile grid. */
function packsFor(def: LayerDef): Pack[] {
  const vector = VECTOR_PACKS[def.id];
  if (vector) return [{ id: def.id, name: def.name, ...vector }];
  if (!def.cacheRoute || (def.cacheStrategy === 'NetworkFirst' && def.id !== 'water-occurrence')) return [];
  const range = zooms(def);
  const bounds = def.source?.kind === 'raster' ? def.source.bounds : undefined;
  const cap = def.id === 'water-occurrence' ? 200 : undefined;
  const variants = (def.variants ?? []).flatMap(variant => {
    const template = tileTemplate(variant.tiles[0]);
    return template ? [{ id: `${def.id}:${variant.id}`, name: `${def.name} ${variant.label}`, template, ...range, bounds, cap }] : [];
  });
  if (variants.length > 1) return variants;
  const template = variants[0]?.template ?? tileTemplate(def.source?.kind === 'raster' ? def.source.tiles[0] : undefined);
  return template ? [{ id: def.id, name: def.name, template, ...range, bounds, cap }] : [];
}

function downloadPacks(): Pack[] {
  const packs: Pack[] = [];
  for (const category of LAYER_CATEGORIES) {
    for (const def of layerRegistry.layers()) if (def.category === category.id) packs.push(...packsFor(def));
  }
  return packs;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function savedAreas(value: unknown, allowed: Set<string>): SavedArea[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is SavedArea => {
    if (!item || typeof item !== 'object') return false;
    const area = item as Partial<SavedArea>;
    return typeof area.id === 'string' && area.id.length > 0 && area.id.length < 80
      && typeof area.name === 'string' && area.name.length > 0 && area.name.length < 160
      && typeof area.template === 'string' && allowed.has(area.template)
      && finite(area.min) && finite(area.max) && area.min >= 0 && area.max >= area.min && area.max <= 22
      && finite(area.west) && finite(area.south) && finite(area.east) && finite(area.north)
      && area.south >= -90 && area.north <= 90 && area.south <= area.north;
  });
}

function viewBox(bounds: LngLatBounds): Box {
  return { west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() };
}

function outside(view: Box, bounds: [number, number, number, number]): boolean {
  return view.east < bounds[0] || view.west > bounds[2] || view.north < bounds[1] || view.south > bounds[3];
}

async function evict(urls: string[]): Promise<void> {
  if (!urls.length || !('caches' in globalThis)) return;
  const opened = await Promise.all((await caches.keys()).map(name => caches.open(name)));
  for (let index = 0; index < urls.length; index += 40) {
    const slice = urls.slice(index, index + 40).map(url => new URL(url, location.origin).href);
    await Promise.all(opened.flatMap(cache => slice.map(url => cache.delete(url).catch(() => false))));
  }
}

export function offlineArea(getBounds: () => LngLatBounds, getBasemap: () => BasemapId, repo: Repo, onStorage?: () => void): { element: HTMLElement; close: () => void } {
  let controller: AbortController | undefined;
  let busy = false;
  let areas: SavedArea[] = [];
  const packs = downloadPacks();
  const byId = new Map(packs.map(pack => [pack.id, pack]));
  const allowed = new Set([USGS_TOPO_TILES, USGS_IMAGERY_TILES, ...packs.map(pack => pack.template)]);
  const source = h('select', { 'aria-label': 'Download layer' }, h('optgroup', { label: 'Basemap' }, h('option', { value: 'basemap' }, 'Current basemap')));
  let group: HTMLOptGroupElement | undefined;
  let groupName = '';
  for (const pack of packs) {
    const name = layerRegistry.get(pack.id.split(':')[0]!)?.category;
    const label = LAYER_CATEGORIES.find(category => category.id === name)?.name ?? 'Layers';
    if (!group || label !== groupName) { groupName = label; group = h('optgroup', { label }); source.append(group); }
    group.append(h('option', { value: pack.id }, pack.name));
  }
  const zoom = h('select', { 'aria-label': 'Download detail' }, ...[12, 13, 14, 15, 16].map(z => h('option', { value: z, ...(z === 14 ? { selected: true } : {}) }, `Zoom ${z}`)));
  const status = h('div', { role: 'status', class: 'offline-download-status' });
  const list = h('div', { class: 'offline-areas', role: 'region', 'aria-label': 'Saved areas' });
  const download = h('button', { type: 'button', class: 'btn', onclick: () => { void start(); } }, 'Download area');
  const cancel = h('button', { type: 'button', class: 'btn', hidden: true, onclick: () => controller?.abort() }, 'Cancel');

  function renderAreas(): void {
    list.hidden = areas.length === 0;
    list.replaceChildren(...areas.map(area => {
      const remove = iconButton('close', `Remove ${area.name}`, () => { void forget(area); });
      remove.disabled = busy;
      return h('div', { class: 'offline-area' }, h('span', { class: 'offline-area-name' }, area.name), remove);
    }));
  }

  async function persist(): Promise<void> {
    try { await repo.setMeta(AREAS, areas); } catch { /* tiles remain cached either way */ }
  }

  async function forget(area: SavedArea): Promise<void> {
    if (busy) return;
    busy = true; download.disabled = true; zoom.disabled = true; source.disabled = true;
    renderAreas();
    const keep = new Set(areas.filter(item => item.id !== area.id).flatMap(item => tiles(item, item.min, item.max, item.template) ?? []));
    const drop = (tiles(area, area.min, area.max, area.template) ?? []).filter(url => !keep.has(url));
    status.textContent = `Removing ${area.name}`;
    try { await evict(drop); } catch { /* the saved area still goes away */ }
    areas = areas.filter(item => item.id !== area.id);
    await persist();
    busy = false; download.disabled = false; zoom.disabled = false; source.disabled = false;
    status.textContent = '';
    renderAreas();
    onStorage?.();
  }

  async function start(): Promise<void> {
    if (busy) return;
    const basemap = getBasemap();
    const pack = byId.get(source.value);
    if (source.value === 'basemap' && basemap === 'streets') { status.textContent = 'Choose Topo or Satellite to download.'; return; }
    if (source.value !== 'basemap' && !pack) return;
    if (!navigator.serviceWorker?.controller) { status.textContent = 'Offline storage is not ready. Reload and try again.'; return; }
    if (!navigator.onLine) { status.textContent = 'Connect to download an area.'; return; }
    const choice: Pack = pack ?? { id: 'basemap', name: basemap === 'topo' ? 'Topo' : 'Satellite', template: basemap === 'topo' ? USGS_TOPO_TILES : USGS_IMAGERY_TILES, min: 0, max: 16 };
    const view = viewBox(getBounds());
    if (choice.bounds && outside(view, choice.bounds)) { status.textContent = 'Move the map into coverage.'; return; }
    const urls = tiles(view, choice.min, Math.min(Number(zoom.value), choice.max), choice.template);
    if (!urls) { status.textContent = 'Area too large. Zoom in or choose less detail.'; return; }
    if (!urls.length) { status.textContent = 'Choose more detail for this layer.'; return; }
    if (choice.cap && urls.length > choice.cap) { status.textContent = 'Area too large. Zoom in or choose less detail.'; return; }
    controller = new AbortController();
    const signal = controller.signal;
    busy = true; download.disabled = true; zoom.disabled = true; source.disabled = true; cancel.hidden = false;
    renderAreas();
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
    if (!signal.aborted && completed > failed) {
      areas = [{ id: crypto.randomUUID(), name: choice.name, template: choice.template, min: choice.min, max: Math.min(Number(zoom.value), choice.max), ...view }, ...areas];
      renderAreas();
      await persist();
    }
    status.textContent = signal.aborted ? `Canceled: ${completed} / ${urls.length}` : failed ? `Downloaded ${completed - failed} / ${urls.length}. ${failed} failed.` : `Downloaded ${choice.name}: ${completed} tiles`;
    controller = undefined; busy = false; download.disabled = false; zoom.disabled = false; source.disabled = false; cancel.hidden = true;
    renderAreas();
    onStorage?.();
  }

  if (typeof repo.getMeta === 'function') void repo.getMeta<unknown>(AREAS).then(value => { areas = savedAreas(value, allowed); renderAreas(); }).catch(() => {});
  return {
    element: h('section', { class: 'offline-download', 'aria-label': 'Offline maps' }, h('div', { class: 'offline-download-controls' }, source, zoom, download, cancel), status, list),
    close: () => controller?.abort(),
  };
}
