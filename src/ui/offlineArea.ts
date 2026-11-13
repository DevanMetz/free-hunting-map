import type { Map as MapLibreMap, MapMouseEvent, MapTouchEvent } from 'maplibre-gl';
import { LAYER_CATEGORIES, layerRegistry, type LayerDef } from '../map/layerRegistry';
import { TRAILS_TILES, USGS_IMAGERY_TILES, USGS_TOPO_TILES, roadTiles, type BasemapId } from '../map/sources';
import { OFFLINE_CACHE, networkFetch } from '../offline/net';
import type { Repo } from '../storage/repo';
import type { LngLat } from '../types';
import { h, iconButton } from './dom';

const LIMIT = 2000;
const PER_PACK = 700;
const TOTAL = 4500;
const AREAS = 'offline.areas';
const latY = (lat: number, n: number): number => {
  const rad = Math.max(-85.051129, Math.min(85.051129, lat)) * Math.PI / 180;
  return Math.floor((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2 * n);
};

interface Box { west: number; south: number; east: number; north: number }
interface Pack { id: string; name: string; template: string; min: number; max: number; bounds?: [number, number, number, number]; coverage?: [number, number, number, number][]; cap?: number }
interface Part { template: string; min: number; max: number; boxes?: Box[] }
interface Bundle extends Box { id: string; name: string; bytes: number; pins: number; parts: Part[] }
interface Legacy extends Box { id: string; name: string; template: string; min: number; max: number; boxes?: Box[]; bytes?: number }
type SavedArea = Bundle | Legacy;

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
  const coverage = def.source?.kind === 'raster' ? def.source.coverage : undefined;
  const cap = def.id === 'water-occurrence' ? 200 : undefined;
  const variants = (def.variants ?? []).flatMap(variant => {
    const template = tileTemplate(variant.tiles[0]);
    return template ? [{ id: `${def.id}:${variant.id}`, name: `${def.name} ${variant.label}`, template, ...range, bounds, coverage, cap }] : [];
  });
  if (variants.length > 1) return variants;
  const template = variants[0]?.template ?? tileTemplate(def.source?.kind === 'raster' ? def.source.tiles[0] : undefined);
  return template ? [{ id: def.id, name: def.name, template, ...range, bounds, coverage, cap }] : [];
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

function validBox(box: Box): boolean {
  return !!box && finite(box.west) && finite(box.south) && finite(box.east) && finite(box.north)
    && box.west <= box.east && box.south >= -90 && box.north <= 90 && box.south <= box.north;
}

function isBundle(area: SavedArea): area is Bundle {
  return 'parts' in area && Array.isArray(area.parts);
}

function areaTiles(area: SavedArea): string[] {
  if (isBundle(area)) return [...new Set(area.parts.flatMap(part => (part.boxes ?? [area]).flatMap(box => tiles(box, part.min, part.max, part.template) ?? [])))];
  return [...new Set((area.boxes ?? [area]).flatMap(box => tiles(box, area.min, area.max, area.template) ?? []))];
}

function savedAreas(value: unknown, allowed: Set<string>): SavedArea[] {
  if (!Array.isArray(value)) return [];
  const areas: SavedArea[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const area = item as Partial<Bundle & Legacy>;
    if (typeof area.id !== 'string' || !area.id || area.id.length >= 80) continue;
    if (typeof area.name !== 'string' || !area.name || area.name.length >= 160) continue;
    if (!validBox(area as Box)) continue;
    const box = { west: area.west as number, south: area.south as number, east: area.east as number, north: area.north as number };
    if (Array.isArray(area.parts)) {
      const parts = area.parts.filter(part => part && typeof part.template === 'string' && allowed.has(part.template) && finite(part.min) && finite(part.max) && part.min >= 0 && part.max >= part.min && part.max <= 22 && (part.boxes === undefined || (Array.isArray(part.boxes) && part.boxes.length <= 100 && part.boxes.every(validBox))));
      if (!parts.length) continue;
      areas.push({ ...box, id: area.id, name: area.name, bytes: finite(area.bytes) && area.bytes >= 0 ? area.bytes : 0, pins: finite(area.pins) && area.pins >= 0 ? area.pins : 0, parts });
      continue;
    }
    if (typeof area.template === 'string' && allowed.has(area.template) && finite(area.min) && finite(area.max) && area.min >= 0 && area.max >= area.min && area.max <= 22 && (area.boxes === undefined || (Array.isArray(area.boxes) && area.boxes.length <= 100 && area.boxes.every(validBox)))) {
      areas.push({ ...box, id: area.id, name: area.name, template: area.template, min: area.min, max: area.max, ...(area.boxes ? { boxes: area.boxes } : {}), ...(finite(area.bytes) ? { bytes: area.bytes } : {}) });
    }
  }
  return areas;
}

function outside(view: Box, bounds: [number, number, number, number]): boolean {
  return view.east < bounds[0] || view.west > bounds[2] || view.north < bounds[1] || view.south > bounds[3];
}

function clip(view: Box, bounds: [number, number, number, number]): Box {
  return {
    west: Math.max(view.west, bounds[0]), south: Math.max(view.south, bounds[1]),
    east: Math.min(view.east, bounds[2]), north: Math.min(view.north, bounds[3]),
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.max(1, Math.round(bytes))} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

async function evict(urls: string[]): Promise<void> {
  if (!urls.length || !('caches' in globalThis)) return;
  const opened = await Promise.all((await caches.keys()).map(name => caches.open(name)));
  for (let index = 0; index < urls.length; index += 40) {
    const slice = urls.slice(index, index + 40).map(url => new URL(url, location.origin).href);
    await Promise.all(opened.flatMap(cache => slice.map(url => cache.delete(url).catch(() => false))));
  }
}

type PointEvent = { lngLat: { lng: number; lat: number }; point: { x: number; y: number }; preventDefault: () => void };

export function offlineArea(map: MapLibreMap, getBasemap: () => BasemapId, repo: Repo, onStorage?: () => void): { element: HTMLElement; close: () => void } {
  let controller: AbortController | undefined;
  let busy = false;
  let drawing = false;
  let areas: SavedArea[] = [];
  const packs = downloadPacks();
  const allowed = new Set([USGS_TOPO_TILES, USGS_IMAGERY_TILES, ...packs.map(pack => pack.template)]);
  const name = h('input', { type: 'text', class: 'field', placeholder: 'Name', 'aria-label': 'Name', maxlength: 80 });
  const zoom = h('select', { 'aria-label': 'Download detail' }, ...[12, 13, 14, 15, 16].map(z => h('option', { value: z, ...(z === 14 ? { selected: true } : {}) }, `Zoom ${z}`)));
  const status = h('div', { role: 'status', class: 'offline-download-status' });
  const list = h('div', { class: 'offline-areas', role: 'region', 'aria-label': 'Saved areas' });
  const download = h('button', { type: 'button', class: 'btn', onclick: () => { void start(viewBox()); } }, 'Download');
  const draw = h('button', { type: 'button', class: 'btn', onclick: () => { drawing ? stopDraw(true) : beginDraw(); } }, 'Draw');
  const cancel = h('button', { type: 'button', class: 'btn', hidden: true, onclick: () => controller?.abort() }, 'Cancel');
  download.disabled = true; zoom.disabled = true; draw.disabled = true;

  function viewBox(): Box {
    const bounds = map.getBounds();
    return { west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() };
  }

  function renderAreas(): void {
    list.hidden = areas.length === 0;
    list.replaceChildren(...areas.map(area => {
      const remove = iconButton('trash', `Delete ${area.name}`, () => { void forget(area); });
      remove.disabled = busy;
      const size = 'bytes' in area && typeof area.bytes === 'number' ? formatBytes(area.bytes) : '';
      return h('div', { class: 'offline-area' }, h('span', { class: 'offline-area-name' }, area.name), size ? h('span', { class: 'mono' }, size) : null, remove);
    }));
  }

  function setBusy(on: boolean): void {
    busy = on;
    download.disabled = on;
    zoom.disabled = on;
    draw.disabled = on;
    name.disabled = on;
  }

  async function forget(area: SavedArea): Promise<void> {
    if (busy) return;
    setBusy(true);
    renderAreas();
    const keep = new Set(areas.filter(item => item.id !== area.id).flatMap(item => areaTiles(item)));
    const drop = areaTiles(area).filter(url => !keep.has(url));
    status.textContent = `Removing ${area.name}`;
    const remaining = areas.filter(item => item.id !== area.id);
    try {
      await repo.setMeta(AREAS, remaining);
    } catch {
      status.textContent = 'Could not update saved areas.';
      setBusy(false);
      renderAreas();
      return;
    }
    areas = remaining;
    try { await evict(drop); } catch { /* cached tiles may remain until eviction */ }
    setBusy(false);
    status.textContent = '';
    renderAreas();
    onStorage?.();
  }

  function bundle(view: Box, maxZoom: number): { parts: Part[]; urls: string[] } | null {
    const basemap = getBasemap();
    const base: Pack = { id: 'basemap', name: 'Map', template: basemap === 'satellite' ? USGS_IMAGERY_TILES : USGS_TOPO_TILES, min: 0, max: 16 };
    const land = packs.filter(pack => pack.id.startsWith('padus-'));
    const terrain = packs.filter(pack => layerRegistry.get(pack.id.split(':')[0]!)?.category === 'terrain');
    const chosen = [base, ...land, ...terrain];
    const parts: Part[] = [];
    const urls: string[] = [];
    for (const pack of chosen) {
      if ((pack.bounds && outside(view, pack.bounds)) || (pack.coverage && pack.coverage.every(bounds => outside(view, bounds)))) continue;
      const boxes = pack.coverage ? pack.coverage.filter(bounds => !outside(view, bounds)).map(bounds => clip(view, bounds)) : [view];
      const ceiling = Math.min(maxZoom, pack.max);
      let fitted: { max: number; urls: string[] } | null = null;
      for (let z = ceiling; z >= pack.min; z--) {
        const pieces = boxes.map(box => tiles(box, pack.min, z, pack.template));
        if (pieces.some(piece => piece === null)) continue;
        const packUrls = [...new Set(pieces.flatMap(piece => piece!))];
        if (!packUrls.length) break;
        if (pack.cap && packUrls.length > pack.cap) continue;
        if (packUrls.length <= PER_PACK && urls.length + packUrls.length <= TOTAL) { fitted = { max: z, urls: packUrls }; break; }
      }
      if (!fitted) {
        const core = pack.id === 'basemap' || pack.id.startsWith('padus-') || pack.id === 'hillshade' || pack.id === 'slope' || pack.id === 'aspect';
        if (core) return null;
        continue;
      }
      urls.push(...fitted.urls);
      parts.push({ template: pack.template, min: pack.min, max: fitted.max, ...(pack.coverage ? { boxes } : {}) });
    }
    return parts.length ? { parts, urls } : null;
  }

  async function pinBytes(view: Box): Promise<{ count: number; bytes: number }> {
    const inside = (coord: LngLat): boolean => coord[0] >= view.west && coord[0] <= view.east && coord[1] >= view.south && coord[1] <= view.north;
    const mine = (await repo.list()).flatMap(item => item.kind === 'waypoint' && inside(item.coord) ? [item] : []);
    const shared = (await repo.scoutRows()).flatMap(row => row.item.kind === 'waypoint' && !row.item.deleted && inside(row.item.coord) && !mine.some(item => item.id === row.item.id) ? [row.item] : []);
    const manifest = JSON.stringify([...mine, ...shared].map(item => [item.id, item.coord]));
    return { count: mine.length + shared.length, bytes: new TextEncoder().encode(manifest).length };
  }

  async function start(view: Box): Promise<void> {
    if (busy || !validBox(view)) return;
    if (!navigator.onLine) { status.textContent = 'Connect to download an area.'; return; }
    if (!('caches' in globalThis)) { status.textContent = 'Offline storage is not ready.'; return; }
    const maxZoom = Number(zoom.value);
    const planned = bundle(view, maxZoom);
    if (!planned) { status.textContent = 'Area too large. Zoom in or choose less detail.'; return; }
    controller = new AbortController();
    const signal = controller.signal;
    setBusy(true);
    cancel.hidden = false;
    renderAreas();
    const cache = await caches.open(OFFLINE_CACHE);
    let completed = 0;
    let failed = 0;
    let bytes = 0;
    let next = 0;
    const label = name.value.trim().slice(0, 80) || 'Area';
    status.textContent = `Downloading ${label}: 0 / ${planned.urls.length}`;
    const worker = async (): Promise<void> => {
      while (!signal.aborted && next < planned.urls.length) {
        const url = planned.urls[next++]!;
        try {
          const response = await networkFetch(url, { signal });
          if (!response.ok) failed++;
          else {
            const body = await response.arrayBuffer();
            const headers = new Headers();
            const type = response.headers.get('content-type');
            if (type) headers.set('content-type', type);
            headers.set('content-length', String(body.byteLength));
            await cache.put(new URL(url, location.origin).href, new Response(body, { status: 200, headers }));
            bytes += body.byteLength;
          }
        } catch { if (!signal.aborted) failed++; }
        if (!signal.aborted) { completed++; status.textContent = `Downloading ${label}: ${completed} / ${planned.urls.length}`; }
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    let saveFailed = false;
    if (!signal.aborted && completed > failed) {
      const pins = await pinBytes(view).catch(() => ({ count: 0, bytes: 0 }));
      const updated: SavedArea[] = [{ id: crypto.randomUUID(), name: label, bytes: bytes + pins.bytes, pins: pins.count, parts: planned.parts, ...view }, ...areas];
      try {
        await repo.setMeta(AREAS, updated);
        areas = updated;
        name.value = '';
      } catch { saveFailed = true; }
    }
    status.textContent = signal.aborted ? `Canceled: ${completed} / ${planned.urls.length}` : saveFailed ? 'Could not save area.' : failed ? `Downloaded ${completed - failed} / ${planned.urls.length}. ${failed} failed.` : `Downloaded ${label}`;
    controller = undefined;
    setBusy(false);
    cancel.hidden = true;
    renderAreas();
    onStorage?.();
  }

  let startPoint: { lng: number; lat: number; x: number; y: number } | undefined;
  let touchGesture = false;
  const preview = 'offline-draw';
  const show = (box: Box | undefined): void => {
    if (!map.getSource(preview)) return;
    const source = map.getSource(preview) as { setData: (data: unknown) => void } | undefined;
    if (!box) { source?.setData({ type: 'FeatureCollection', features: [] }); return; }
    source?.setData({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[box.west, box.south], [box.east, box.south], [box.east, box.north], [box.west, box.north], [box.west, box.south]]] }, properties: {} });
  };
  const isTouch = (event: PointEvent): boolean => {
    const original = (event as { originalEvent?: Event }).originalEvent;
    return typeof TouchEvent !== 'undefined' && original instanceof TouchEvent;
  };
  const down = (event: PointEvent): void => {
    const touch = isTouch(event);
    if (!touch && touchGesture) return;
    touchGesture = touch;
    event.preventDefault();
    startPoint = { lng: event.lngLat.lng, lat: event.lngLat.lat, x: event.point.x, y: event.point.y };
  };
  const move = (event: PointEvent): void => {
    if (!isTouch(event) && touchGesture) return;
    if (!startPoint || Math.hypot(event.point.x - startPoint.x, event.point.y - startPoint.y) < 6) return;
    show(rect(startPoint, event.lngLat));
  };
  const up = (event: PointEvent): void => {
    if (!isTouch(event) && touchGesture) return;
    if (isTouch(event)) window.setTimeout(() => { touchGesture = false; }, 800);
    if (!startPoint) return;
    const moved = Math.hypot(event.point.x - startPoint.x, event.point.y - startPoint.y) >= 6;
    const box = moved ? rect(startPoint, event.lngLat) : undefined;
    startPoint = undefined;
    stopDraw(false);
    if (box && box.east - box.west >= 0.0003 && box.north - box.south >= 0.0003) void start(box);
  };

  function rect(a: { lng: number; lat: number }, b: { lng: number; lat: number }): Box {
    return { west: Math.min(a.lng, b.lng), south: Math.min(a.lat, b.lat), east: Math.max(a.lng, b.lng), north: Math.max(a.lat, b.lat) };
  }

  function beginDraw(): void {
    if (busy || drawing) return;
    drawing = true;
    draw.textContent = 'Cancel';
    document.body.dataset.offlineDrawing = 'true';
    map.dragPan.disable();
    map.getCanvas().style.cursor = 'crosshair';
    if (!map.getSource(preview)) {
      map.addSource(preview, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: preview, type: 'line', source: preview, paint: { 'line-color': '#e87826', 'line-width': 2 } });
    }
    map.on('mousedown', down as (event: MapMouseEvent) => void);
    map.on('mousemove', move as (event: MapMouseEvent) => void);
    map.on('mouseup', up as (event: MapMouseEvent) => void);
    map.on('touchstart', down as (event: MapTouchEvent) => void);
    map.on('touchmove', move as (event: MapTouchEvent) => void);
    map.on('touchend', up as (event: MapTouchEvent) => void);
  }

  function stopDraw(clearNow: boolean): void {
    if (!drawing && !map.getSource(preview)) return;
    drawing = false;
    draw.textContent = 'Draw';
    startPoint = undefined;
    map.dragPan.enable();
    map.getCanvas().style.cursor = '';
    map.off('mousedown', down as (event: MapMouseEvent) => void);
    map.off('mousemove', move as (event: MapMouseEvent) => void);
    map.off('mouseup', up as (event: MapMouseEvent) => void);
    map.off('touchstart', down as (event: MapTouchEvent) => void);
    map.off('touchmove', move as (event: MapTouchEvent) => void);
    map.off('touchend', up as (event: MapTouchEvent) => void);
    if (map.getLayer(preview)) map.removeLayer(preview);
    if (map.getSource(preview)) map.removeSource(preview);
    const clear = (): void => { delete document.body.dataset.offlineDrawing; };
    if (clearNow) clear();
    else { map.once('click', clear); window.setTimeout(clear, 400); }
  }

  void repo.getMeta<unknown>(AREAS).then(value => {
    areas = savedAreas(value, allowed);
    download.disabled = false; zoom.disabled = false; draw.disabled = false;
    renderAreas();
  }).catch(() => { status.textContent = 'Could not load saved areas. Reload and try again.'; });
  return {
    element: h('section', { class: 'offline-download', 'aria-label': 'Offline maps' }, h('div', { class: 'offline-download-controls' }, name, zoom, download, draw, cancel), status, list),
    close: () => { controller?.abort(); stopDraw(true); },
  };
}
