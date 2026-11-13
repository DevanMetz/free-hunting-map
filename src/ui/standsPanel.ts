import type { FeatureCollection } from 'geojson';
import type { GeoJSONSource, Map as MlMap, MapMouseEvent } from 'maplibre-gl';
import { BoxDrawing, type Point } from '../lidar/boxDrawing';
import { shortDistance } from '../map/geo';
import { applyWind, findStands, type StandSpot } from '../stands/analyze';
import { limitBox, loadGround, StandSearchError, type BBox, type Ground } from '../stands/load';
import { clearPressure, collectPressure } from '../stands/pressure';
import { rememberStand } from '../stands/selection';
import { windDir } from '../stands/winds';
import type { Waypoint } from '../types';
import { useFeature } from '../usage';
import type { AppContext } from './context';
import { h, toast } from './dom';
import { windPicks } from './windPicks';

const SRC = 'ohm-stand-spots';
const FILL = `${SRC}-fill`;
const LINE = `${SRC}-line`;
const WALK = `${SRC}-walk`;
const PTS = `${SRC}-pts`;

export function openStandsPanel(ctx: AppContext): void {
  const map = ctx.map.map;
  let wind = windDir(0);
  let windTouched = false;
  let ground: Ground | null = null;
  let spots: StandSpot[] = [];
  let selected = 0;
  let box: BBox | null = null;
  let drawing = false;
  let saving = false;
  let searchId = 0;
  let searchAbort: AbortController | undefined;
  let restore: boolean[] = [];
  const gesture = new BoxDrawing();
  const handlers = [map.dragPan, map.boxZoom, map.doubleClickZoom, map.touchZoomRotate];
  const listener = new AbortController();

  const picks = windPicks('Wind', false, [wind], next => {
    const dir = next[0];
    if (!dir) return;
    wind = dir;
    windTouched = true;
    if (ground && spots.length) {
      applyWind(ground, spots, wind);
      paint();
    }
  });
  const viewBtn = h('button', { type: 'button', class: 'btn primary', onclick: () => search(viewBox(map)) }, 'This view');
  const drawBtn = h('button', { type: 'button', class: 'btn', 'aria-pressed': 'false', onclick: () => drawing ? stopDrawing() : startDrawing() }, 'Draw');
  const status = h('output', { 'aria-live': 'polite' });
  const list = h('div', { class: 'stand-list' });
  const root = h('div', { class: 'form stand-finder' }, picks, h('div', { class: 'button-row' }, viewBtn, drawBtn), status, list);

  const onStyle = (): void => install();
  const onClick = (event: MapMouseEvent): void => {
    if (!map.getLayer(PTS)) return;
    const hit = map.queryRenderedFeatures(event.point, { layers: [PTS] })[0];
    const index = Number(hit?.properties?.index);
    if (Number.isInteger(index) && spots[index]) select(index, true);
  };

  function install(): void {
    try {
      if (!map.getSource(SRC)) map.addSource(SRC, { type: 'geojson', data: empty() });
      if (!map.getLayer(FILL)) map.addLayer({ id: FILL, type: 'fill', source: SRC, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#e7c36a', 'fill-opacity': 0.14 } });
      if (!map.getLayer(LINE)) map.addLayer({ id: LINE, type: 'line', source: SRC, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'line-color': '#e7c36a', 'line-width': 2 } });
      if (!map.getLayer(WALK)) map.addLayer({ id: WALK, type: 'line', source: SRC, filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#b6e38a', 'line-width': 3, 'line-dasharray': [1.4, 1] } });
      if (!map.getLayer(PTS)) map.addLayer({
        id: PTS, type: 'circle', source: SRC, filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': ['case', ['==', ['get', 'on'], 1], 7, 5],
          'circle-color': ['case', ['==', ['get', 'on'], 1], '#e87826', '#f3e2b0'],
          'circle-stroke-color': '#1b231d',
          'circle-stroke-width': 1.5,
        },
      });
      paint();
    } catch { /* style is mid-swap */ }
  }

  function paint(): void {
    const source = map.getSource(SRC) as GeoJSONSource | undefined;
    if (!source) return;
    const ring = box ? [[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]], [box[0], box[1]]] : null;
    const walk = spots[selected]?.walk;
    const features: FeatureCollection['features'] = [
      ...(ring ? [{ type: 'Feature' as const, geometry: { type: 'Polygon' as const, coordinates: [ring] }, properties: {} }] : []),
      ...(walk && walk.length > 1 ? [{ type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: walk }, properties: {} }] : []),
      ...spots.map((spot, index) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: spot.coord },
        properties: { index, on: index === selected ? 1 : 0 },
      })),
    ];
    source.setData({ type: 'FeatureCollection', features });
  }

  function renderList(): void {
    list.replaceChildren(...spots.map((spot, index) => h(
      'div',
      { class: 'stand-row' },
      h(
        'button',
        {
          type: 'button',
          class: index === selected ? 'stand-spot selected' : 'stand-spot',
          'aria-pressed': index === selected ? 'true' : 'false',
          onclick: () => select(index, true),
        },
        h('strong', {}, spot.reasons.join(' · ')),
        h('span', { class: 'meta' }, spot.winds.join(' ')),
        spot.access ? h('span', { class: 'meta' }, `${spot.access.name || 'Access'} · ${shortDistance(spot.access.meters)}`) : null,
      ),
      h('button', { type: 'button', class: 'btn', onclick: () => void save(index) }, 'Save'),
    )));
  }

  function select(index: number, ease: boolean): void {
    const spot = spots[index];
    if (!spot) return;
    selected = index;
    paint();
    renderList();
    if (ease) map.easeTo({ center: spot.coord, zoom: Math.max(map.getZoom(), 14), duration: 400 });
  }

  function busy(on: boolean): void {
    viewBtn.disabled = on;
    if (!drawing) drawBtn.disabled = on;
  }

  function search(raw: BBox): void {
    stopDrawing();
    const limited = limitBox(raw);
    if (!limited) {
      status.textContent = 'Area too small';
      return;
    }
    box = limited;
    paint();
    searchAbort?.abort();
    const id = ++searchId;
    const controller = searchAbort = new AbortController();
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, 25_000);
    busy(true);
    status.textContent = '';
    list.replaceChildren(h('div', { class: 'spinner', 'aria-label': 'Searching' }));
    const pins = ctx.items().flatMap(item => item.kind === 'waypoint' && item.icon === 'truck' ? [{ coord: item.coord, name: item.name || 'Truck' }] : []);
    void Promise.all([
      loadGround(limited, controller.signal),
      collectPressure(map, limited, pins, controller.signal),
    ]).then(([nextGround, pressure]) => {
      if (id !== searchId || !root.isConnected) return;
      ground = nextGround;
      spots = findStands(nextGround, pressure, wind);
      selected = 0;
      status.textContent = spots.length ? '' : 'No spots';
      paint();
      renderList();
    }).catch(err => {
      if (id !== searchId || !root.isConnected || (controller.signal.aborted && !timedOut)) return;
      ground = null;
      spots = [];
      status.textContent = err instanceof StandSearchError ? err.message : 'Search failed';
      paint();
      list.replaceChildren();
    }).finally(() => {
      window.clearTimeout(timer);
      if (id === searchId && root.isConnected) busy(false);
    });
  }

  async function save(index: number): Promise<void> {
    const spot = spots[index];
    if (!spot || saving) return;
    saving = true;
    try {
      if (!ctx.visibility().showPins) await ctx.setTypeVisibility({ showPins: true });
      const wp = await ctx.repo.create<Waypoint>({
        kind: 'waypoint',
        name: spot.reasons.join(' · ').slice(0, 120),
        note: '',
        icon: 'stand',
        coord: spot.coord,
        winds: spot.winds,
      });
      useFeature('marker_add');
      rememberStand(wp.id);
      ctx.openItem(wp);
    } catch {
      toast('Could not save pin');
    } finally {
      saving = false;
    }
  }

  function startDrawing(): void {
    if (viewBtn.disabled) return;
    drawing = true;
    gesture.cancel();
    restore = handlers.map(handler => handler.isEnabled());
    handlers.forEach(handler => handler.disable());
    const canvas = map.getCanvas();
    canvas.dataset.standDrawing = '';
    canvas.style.cursor = 'crosshair';
    drawBtn.classList.add('selected');
    drawBtn.textContent = 'Cancel';
    drawBtn.setAttribute('aria-pressed', 'true');
  }

  function stopDrawing(): void {
    if (!drawing) return;
    drawing = false;
    gesture.cancel();
    restore.forEach((enabled, i) => { if (enabled) handlers[i]?.enable(); });
    restore = [];
    const canvas = map.getCanvas();
    delete canvas.dataset.standDrawing;
    canvas.style.cursor = '';
    drawBtn.classList.remove('selected');
    drawBtn.textContent = 'Draw';
    drawBtn.setAttribute('aria-pressed', 'false');
  }

  function bindPointers(): void {
    const canvas = map.getCanvas();
    const position = (event: PointerEvent): { pixel: Point; coord: Point } => {
      const rect = canvas.getBoundingClientRect();
      const pixel: Point = [event.clientX - rect.left, event.clientY - rect.top];
      const point = map.unproject(pixel);
      return { pixel, coord: [point.lng, point.lat] };
    };
    canvas.addEventListener('pointerdown', event => {
      if (!drawing || !event.isPrimary || event.button !== 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const point = position(event);
      gesture.start(point.pixel, point.coord);
      canvas.setPointerCapture(event.pointerId);
    }, { capture: true, signal: listener.signal });
    canvas.addEventListener('pointermove', event => {
      if (!drawing || !event.isPrimary) return;
      const point = position(event);
      const preview = gesture.move(point.pixel, point.coord);
      if (!preview) return;
      box = preview;
      paint();
    }, { capture: true, signal: listener.signal });
    canvas.addEventListener('pointerup', event => {
      if (!drawing || !event.isPrimary) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const point = position(event);
      gesture.move(point.pixel, point.coord);
      const result = gesture.end(point.coord);
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      if (!result) return;
      search(result);
    }, { capture: true, signal: listener.signal });
  }

  function close(): void {
    searchId++;
    searchAbort?.abort();
    listener.abort();
    stopDrawing();
    map.off('style.load', onStyle);
    map.off('click', onClick);
    clearPressure(map);
    try {
      if (map.getLayer(PTS)) map.removeLayer(PTS);
      if (map.getLayer(WALK)) map.removeLayer(WALK);
      if (map.getLayer(LINE)) map.removeLayer(LINE);
      if (map.getLayer(FILL)) map.removeLayer(FILL);
      if (map.getSource(SRC)) map.removeSource(SRC);
    } catch { /* style is mid-swap */ }
    delete document.body.dataset.stands;
  }

  document.body.dataset.stands = '';
  map.on('style.load', onStyle);
  map.on('click', onClick);
  bindPointers();
  install();
  ctx.sheet.open('stands', 'Stands', root, close);
  void ctx.repo.getMeta<{ current?: { windDir?: number } }>('conditions:last').then(saved => {
    if (windTouched || !root.isConnected) return;
    const deg = saved?.current?.windDir;
    if (typeof deg !== 'number' || !Number.isFinite(deg)) return;
    wind = windDir(deg);
    picks.set([wind]);
    if (ground && spots.length) {
      applyWind(ground, spots, wind);
      paint();
    }
  });
}

function viewBox(map: MlMap): BBox {
  const bounds = map.getBounds();
  return [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
}

function empty(): FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}
