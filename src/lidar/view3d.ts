import { Marker, type GeoJSONSource } from 'maplibre-gl';
import { BoxDrawing, estimateBox, type Point } from './boxDrawing';
import { loadPointCloud } from './cloud';
import { checkedBox, type Box } from './ept';
import { mountPointCloud } from './viewer3d';
import type { AppContext } from '../ui/context';
import { h } from '../ui/dom';

export interface Lidar3d {
  open(): void;
}

const empty = { type: 'FeatureCollection' as const, features: [] };

function areaText(box: Box): string {
  const estimate = estimateBox(box);
  return estimate.over ? '>1 mi²' : `${estimate.area.toFixed(2)} / 1 mi²`;
}

function boxMessage(box: Box): string {
  try {
    checkedBox(box);
    return '';
  } catch (err) {
    return err instanceof Error ? err.message : 'Invalid box';
  }
}

function failMessage(err: unknown): string {
  if (!(err instanceof Error) || err.name === 'AbortError') return '';
  if (/square mile|4 km|Invalid box|Unsupported EPT|EPT node limit/.test(err.message)) return err.message;
  return 'Lidar unavailable';
}

export function createLidar3d(app: AppContext): Lidar3d {
  const map = app.map.map;
  const gesture = new BoxDrawing();
  const handlers = [map.dragPan, map.boxZoom, map.doubleClickZoom, map.touchZoomRotate];
  const badge = h('output', { class: 'trail-box-size' });
  const marker = new Marker({ element: badge, anchor: 'bottom' });
  const drawBtn = h('button', { type: 'button', class: 'btn', 'aria-pressed': 'false' }, 'Draw box');
  const viewBtn = h('button', { type: 'button', class: 'btn primary', disabled: true }, 'View');
  const cancelBtn = h('button', { type: 'button', class: 'btn', hidden: true }, 'Cancel');
  const status = h('output', { 'aria-live': 'polite' });
  const panel = h('div', { class: 'form lidar-3d-panel' }, h('div', { class: 'button-row' }, drawBtn, viewBtn, cancelBtn), status);

  let box: Box | undefined;
  let drawing = false;
  let loading = false;
  let listening = false;
  let loadId = 0;
  let loadAbort: AbortController | undefined;
  let restore: boolean[] = [];
  let closeViewer: (() => void) | undefined;
  const listenerAbort = { current: new AbortController() };

  function install(): void {
    if (!listening) return;
    try {
      // isStyleLoaded stays false until every tile finishes. The stylesheet can still accept a source.
      if (!map.getSource('lidar-3d-box')) map.addSource('lidar-3d-box', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      if (!map.getLayer('lidar-3d-box')) map.addLayer({
        id: 'lidar-3d-box', type: 'line', source: 'lidar-3d-box',
        paint: { 'line-color': '#ffc45c', 'line-width': 2 },
      });
    } catch (err) {
      if (err instanceof Error && err.message.includes('not done loading')) return;
      status.textContent = err instanceof Error ? err.message : 'Map layer failed';
      return;
    }
    showBox();
  }

  function showBox(): void {
    if (!map.getLayer('lidar-3d-box') || !map.getSource('lidar-3d-box')) {
      if (!box) marker.remove();
      return;
    }
    if (!box) {
      (map.getSource('lidar-3d-box') as GeoJSONSource).setData(empty);
      marker.remove();
      return;
    }
    const estimate = estimateBox(box);
    badge.textContent = areaText(box);
    badge.classList.toggle('over', estimate.over);
    marker.setLngLat([(box[0] + box[2]) / 2, box[3]]).addTo(map);
    map.setPaintProperty('lidar-3d-box', 'line-color', estimate.over ? '#ff6262' : '#ffc45c');
    const [x0, y0, x1, y1] = box;
    (map.getSource('lidar-3d-box') as GeoJSONSource).setData({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] },
    });
  }

  function uninstall(): void {
    marker.remove();
    try {
      if (map.getLayer('lidar-3d-box')) map.removeLayer('lidar-3d-box');
      if (map.getSource('lidar-3d-box')) map.removeSource('lidar-3d-box');
    } catch { /* style is mid-swap */ }
  }

  function stopDrawing(): void {
    drawing = false;
    gesture.cancel();
    restore.forEach((enabled, i) => { if (enabled) handlers[i]!.enable(); });
    restore = [];
    drawBtn.classList.remove('selected');
    drawBtn.textContent = 'Draw box';
    drawBtn.setAttribute('aria-pressed', 'false');
    const canvas = map.getCanvas();
    delete canvas.dataset.lidarDrawing;
    canvas.style.cursor = '';
  }

  function cancelDrawing(): void {
    if (!drawing) return;
    stopDrawing();
    box = undefined;
    viewBtn.disabled = true;
    showBox();
  }

  function onStyle(): void {
    if (listening) install();
  }

  function bindPointers(signal: AbortSignal): void {
    const canvas = map.getCanvas();
    let suppressClick = false;
    const position = (e: PointerEvent): { pixel: Point; coord: Point } => {
      const rect = canvas.getBoundingClientRect();
      const pixel: Point = [e.clientX - rect.left, e.clientY - rect.top];
      const p = map.unproject(pixel);
      return { pixel, coord: [p.lng, p.lat] };
    };
    canvas.addEventListener('pointerdown', e => {
      if (!drawing || !e.isPrimary || e.button !== 0) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const p = position(e);
      suppressClick = true;
      gesture.start(p.pixel, p.coord);
      canvas.setPointerCapture(e.pointerId);
    }, { capture: true, signal });
    canvas.addEventListener('pointermove', e => {
      if (!drawing || !e.isPrimary) return;
      const p = position(e);
      const preview = gesture.move(p.pixel, p.coord);
      if (!preview) return;
      box = preview;
      showBox();
    }, { capture: true, signal });
    canvas.addEventListener('pointerup', e => {
      if (!drawing || !e.isPrimary) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const p = position(e);
      gesture.move(p.pixel, p.coord);
      const result = gesture.end(p.coord);
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      if (!result) return;
      box = result;
      stopDrawing();
      const message = boxMessage(box);
      viewBtn.disabled = message !== '';
      status.textContent = message;
      showBox();
    }, { capture: true, signal });
    canvas.addEventListener('pointercancel', () => cancelDrawing(), { signal });
    canvas.addEventListener('click', e => {
      if (!drawing && !suppressClick) return;
      suppressClick = false;
      e.preventDefault();
      e.stopImmediatePropagation();
    }, { capture: true, signal });
  }

  function startSession(): void {
    if (listening) return;
    listening = true;
    listenerAbort.current = new AbortController();
    map.on('style.load', onStyle);
    bindPointers(listenerAbort.current.signal);
    install();
  }

  function closeSession(): void {
    loadId++;
    loadAbort?.abort();
    loadAbort = undefined;
    loading = false;
    closeViewer?.();
    closeViewer = undefined;
    stopDrawing();
    if (listening) {
      listening = false;
      listenerAbort.current.abort();
      map.off('style.load', onStyle);
      uninstall();
    }
    box = undefined;
    viewBtn.disabled = true;
    drawBtn.disabled = false;
    cancelBtn.hidden = true;
    status.textContent = '';
  }

  function busy(on: boolean): void {
    loading = on;
    cancelBtn.hidden = !on;
    drawBtn.disabled = on;
    viewBtn.disabled = on || !box || boxMessage(box) !== '';
  }

  drawBtn.onclick = () => {
    if (loading) return;
    if (drawing) { cancelDrawing(); return; }
    drawing = true;
    gesture.cancel();
    box = undefined;
    viewBtn.disabled = true;
    status.textContent = '';
    showBox();
    restore = handlers.map(handler => handler.isEnabled());
    handlers.forEach(handler => handler.disable());
    const canvas = map.getCanvas();
    canvas.dataset.lidarDrawing = '';
    canvas.style.cursor = 'crosshair';
    drawBtn.classList.add('selected');
    drawBtn.textContent = 'Cancel box';
    drawBtn.setAttribute('aria-pressed', 'true');
  };

  cancelBtn.onclick = () => {
    loadId++;
    loadAbort?.abort();
    loadAbort = undefined;
    busy(false);
    status.textContent = 'Cancelled';
  };

  viewBtn.onclick = () => {
    if (!box || loading || boxMessage(box)) return;
    stopDrawing();
    const id = ++loadId;
    const controller = loadAbort = new AbortController();
    const selected = box;
    busy(true);
    status.textContent = 'Loading';
    void loadPointCloud(selected, controller.signal, p => {
      if (id === loadId) status.textContent = p.stage ?? (p.total ? `Loading ${p.done}/${p.total}` : 'Loading');
    }).then(cloud => {
      if (id !== loadId || controller.signal.aborted) return;
      busy(false);
      if (!cloud.count) { status.textContent = 'No lidar coverage'; return; }
      status.textContent = '';
      try {
        closeViewer = mountPointCloud(cloud, app.map.mapState.basemap, () => app.sheet.close());
      } catch (err) {
        closeViewer = undefined;
        status.textContent = failMessage(err) || '3D unavailable';
      }
    }).catch(err => {
      if (id !== loadId || controller.signal.aborted) return;
      busy(false);
      status.textContent = failMessage(err) || 'Lidar unavailable';
    });
  };

  return {
    open() {
      app.sheet.open('lidar3d', '3D lidar', panel, closeSession);
      startSession();
    },
  };
}
