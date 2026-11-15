import type { GeoJSONSource, Map as MlMap, MapMouseEvent } from 'maplibre-gl';
import { acreage } from '../beds/metrics';
import { isStudy, landBand, profileFromBeds, sampleBands, TERRAIN_LABEL, TERRAINS, type BedProfile, type BedSample, type LandBands, type TerrainKind } from '../beds/profile';
import { analyzeBedding, beddingState, chooseTerrain, editBedProfile, holdBedding, releaseBedding, subscribeBedding } from '../beds/session';
import { fillBed } from '../beds/sample';
import { bedSharing, flushBeds, setBedSharing } from '../beds/share';
import { BoxDrawing, type Point } from '../lidar/boxDrawing';
import { roundCoord } from '../map/geo';
import { limitBox, type BBox } from '../stands/load';
import type { AppContext } from './context';
import { aspectDial } from './aspectDial';
import { h, toast } from './dom';
import { createWaypoint } from './tools';

export function openBedsPanel(ctx: AppContext): void {
  const map = ctx.map.map;
  const state = beddingState();
  let profile = state.profile;
  let drawing = false;
  let arming = false;
  let restore: boolean[] = [];
  const gesture = new BoxDrawing();
  const handlers = [map.dragPan, map.boxZoom, map.doubleClickZoom, map.touchZoomRotate];
  const listener = new AbortController();

  const presets = h('div', { class: 'bed-presets', role: 'radiogroup', 'aria-label': 'Terrain' });
  const presetButtons = new Map<TerrainKind, HTMLButtonElement>();
  for (const kind of TERRAINS) {
    const button = h('button', {
      type: 'button',
      role: 'radio',
      'aria-label': isStudy(kind) ? TERRAIN_LABEL[kind] : `${TERRAIN_LABEL[kind]}, starting point`,
      ...(isStudy(kind) ? {} : { title: 'Starting point' }),
      onclick: () => { void chooseTerrain(kind); },
    }, isStudy(kind) ? TERRAIN_LABEL[kind] : `${TERRAIN_LABEL[kind]}*`);
    presetButtons.set(kind, button);
    presets.append(button);
  }

  const dial = aspectDial(profile.aspectStart, profile.aspectEnd, (aspectStart, aspectEnd) => {
    profile = { ...profile, aspectStart, aspectEnd, tuned: 'custom' };
    editBedProfile(profile);
  });
  const position = rangeRow('Position', 0, 100, 1, (position) => apply({ position }));
  const openness = rangeRow('Openness', 60, 110, 1, (openness) => apply({ openness }));
  const steepness = rangeRow('Steepness', 0, 60, 1, (steepness) => apply({ steepness }));
  const acres = h('div', { class: 'bed-acres' });
  const pooled = h('output', { class: 'bed-note' });
  const compare = h('div', { class: 'bed-compare', 'aria-label': 'Beds and land' });
  const useBeds = h('button', { type: 'button', class: 'btn', hidden: true, onclick: () => {
    const learned = profileFromBeds(samples(), profile);
    if (!learned) return;
    profile = learned;
    editBedProfile(profile);
    sync();
  } }, 'Use beds');
  const status = h('output', { 'aria-live': 'polite' });
  const viewBtn = h('button', { type: 'button', class: 'btn primary', onclick: () => search(viewBox(map)) }, 'This view');
  const drawBtn = h('button', { type: 'button', class: 'btn', 'aria-pressed': 'false', onclick: () => drawing ? stopDrawing() : startDrawing() }, 'Draw');
  const bedBtn = h('button', { type: 'button', class: 'btn', 'aria-pressed': 'false', 'aria-label': 'Bed pin', onclick: () => toggleArm() }, 'Bed');
  const share = h('input', { type: 'checkbox', role: 'switch', 'aria-label': 'Share bed terrain' });
  const root = h('div', { class: 'form beds-panel' },
    presets,
    dial,
    position.element,
    openness.element,
    steepness.element,
    acres,
    pooled,
    h('div', { class: 'button-row' }, viewBtn, drawBtn, bedBtn),
    compare,
    useBeds,
    h('label', { class: 'toggle' }, share, 'Share bed terrain'),
    status,
  );

  function apply(patch: Partial<Pick<BedProfile, 'position' | 'openness' | 'steepness'>>): void {
    profile = { ...beddingState().profile, ...patch, tuned: 'custom' };
    editBedProfile(profile);
  }

  function search(raw: BBox): void {
    stopDrawing();
    const limited = limitBox(raw);
    if (!limited) { status.textContent = 'Area too small'; return; }
    holdBedding();
    ctx.map.setLayer('bedding', true);
    releaseBedding();
    showBox(limited);
    analyzeBedding(limited);
  }

  function sync(): void {
    const current = beddingState();
    profile = current.profile;
    for (const [kind, button] of presetButtons) {
      const on = profile.terrain === kind && profile.tuned !== 'custom' && profile.tuned !== 'beds';
      button.setAttribute('aria-checked', String(on));
      button.classList.toggle('suggested', current.suggested === kind && profile.terrain !== kind);
    }
    if (document.activeElement !== dial) dial.set(profile.aspectStart, profile.aspectEnd);
    if (!position.element.contains(document.activeElement)) position.set(profile.position);
    if (!openness.element.contains(document.activeElement)) openness.set(profile.openness);
    if (!steepness.element.contains(document.activeElement)) steepness.set(profile.steepness);
    const metrics = current.metrics;
    acres.replaceChildren();
    if (metrics && metrics.z.length) {
      const counts = acreage(metrics, profile);
      const rows: [string, number][] = [['Aspect', counts.aspect], ['Position', counts.position], ['Openness', counts.openness], ['Steepness', counts.steep]];
      for (const [label, count] of rows) acres.append(acreLine(label, count, counts.total, counts.cellM2));
    }
    pooled.textContent = current.pooled;
    status.textContent = current.busy ? '' : current.status;
    viewBtn.disabled = current.busy;
    if (!drawing) drawBtn.disabled = current.busy;
    renderBeds(metrics ? landBand(metrics.aspect, metrics.position, metrics.openness, metrics.steepness) : null);
    if (current.busy && !acres.childElementCount) acres.append(h('div', { class: 'spinner', 'aria-label': 'Loading' }));
  }

  function renderBeds(land: LandBands | null): void {
    const beds = samples();
    compare.replaceChildren();
    useBeds.hidden = beds.length < 3;
    if (beds.length < 3) return;
    const learned = sampleBands(beds);
    compare.append(h('div', {}, `Beds ${beds.length}`));
    compare.append(h('div', {}, pair(learned.aspect ? arc(learned.aspect[0], learned.aspect[1]) : '', land?.aspect ? arc(land.aspect[0], land.aspect[1]) : '')));
    compare.append(h('div', {}, pair(band(learned.position, '%'), land?.position ? band(land.position, '%') : '')));
    compare.append(h('div', {}, pair(band(learned.openness, '°'), land?.openness ? band(land.openness, '°') : '')));
    compare.append(h('div', {}, pair(band(learned.steepness, '°'), land?.steepness ? band(land.steepness, '°') : '')));
  }

  function samples(): BedSample[] {
    return ctx.items().flatMap(item => item.kind === 'waypoint' && !item.deleted && item.icon === 'bed' && item.bed ? [item.bed] : []);
  }

  function toggleArm(): void {
    arming = !arming;
    if (arming) document.body.dataset.bedPin = '';
    else delete document.body.dataset.bedPin;
    bedBtn.setAttribute('aria-pressed', String(arming));
    bedBtn.classList.toggle('primary', arming);
  }

  async function drop(event: MapMouseEvent): Promise<void> {
    if (!arming) return;
    toggleArm();
    const wp = await createWaypoint(ctx, roundCoord([event.lngLat.lng, event.lngLat.lat]), 'bed');
    if (!wp) return;
    void fillBed(ctx.repo, wp.id);
    ctx.openItem(wp);
  }

  function startDrawing(): void {
    if (viewBtn.disabled) return;
    drawing = true;
    gesture.cancel();
    restore = handlers.map(handler => handler.isEnabled());
    handlers.forEach(handler => handler.disable());
    map.getCanvas().dataset.bedDrawing = '';
    map.getCanvas().style.cursor = 'crosshair';
    drawBtn.setAttribute('aria-pressed', 'true');
    drawBtn.textContent = 'Cancel';
  }

  function stopDrawing(): void {
    if (!drawing) return;
    drawing = false;
    gesture.cancel();
    restore.forEach((enabled, index) => { if (enabled) handlers[index]?.enable(); });
    restore = [];
    const canvas = map.getCanvas();
    delete canvas.dataset.bedDrawing;
    canvas.style.cursor = '';
    drawBtn.setAttribute('aria-pressed', 'false');
    drawBtn.textContent = 'Draw';
  }

  function bindPointers(): void {
    const canvas = map.getCanvas();
    const positionOf = (event: PointerEvent): { pixel: Point; coord: Point } => {
      const rect = canvas.getBoundingClientRect();
      const pixel: Point = [event.clientX - rect.left, event.clientY - rect.top];
      const point = map.unproject(pixel);
      return { pixel, coord: [point.lng, point.lat] };
    };
    canvas.addEventListener('pointerdown', event => {
      if (!drawing || !event.isPrimary || event.button !== 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const point = positionOf(event);
      gesture.start(point.pixel, point.coord);
      canvas.setPointerCapture(event.pointerId);
    }, { capture: true, signal: listener.signal });
    canvas.addEventListener('pointermove', event => {
      if (!drawing || !event.isPrimary) return;
      const point = positionOf(event);
      const preview = gesture.move(point.pixel, point.coord);
      if (preview) showBox(preview);
    }, { capture: true, signal: listener.signal });
    canvas.addEventListener('pointerup', event => {
      if (!drawing || !event.isPrimary) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const point = positionOf(event);
      gesture.move(point.pixel, point.coord);
      const result = gesture.end(point.coord);
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      if (result) search(result);
    }, { capture: true, signal: listener.signal });
  }

  const BOX = 'ohm-bed-box';
  let outline: BBox | null = null;
  function installBox(): void {
    try {
      if (!map.getSource(BOX)) map.addSource(BOX, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      if (!map.getLayer(BOX)) map.addLayer({ id: BOX, type: 'line', source: BOX, paint: { 'line-color': '#c47a2c', 'line-width': 2 } });
    } catch { /* style is mid-swap */ }
    if (outline) showBox(outline);
  }
  function showBox(next: BBox): void {
    outline = next;
    const source = map.getSource(BOX) as GeoJSONSource | undefined;
    if (!source) return;
    const ring = [[next[0], next[1]], [next[2], next[1]], [next[2], next[3]], [next[0], next[3]], [next[0], next[1]]];
    source.setData({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } });
  }
  function clearBox(): void {
    outline = null;
    try {
      if (map.getLayer(BOX)) map.removeLayer(BOX);
      if (map.getSource(BOX)) map.removeSource(BOX);
    } catch { /* style is mid-swap */ }
  }

  installBox();
  map.on('style.load', installBox);
  const unsubscribe = subscribeBedding(sync);
  const onItems = (): void => sync();
  ctx.repo.addEventListener('change', onItems);
  map.on('click', drop);
  bindPointers();
  share.addEventListener('change', () => {
    share.disabled = true;
    void setBedSharing(ctx.repo, share.checked).then(() => flushBeds(ctx.repo)).catch(() => {
      share.checked = !share.checked;
      toast('Could not save');
    }).finally(() => { share.disabled = false; });
  });
  void bedSharing(ctx.repo).then(on => { if (root.isConnected) share.checked = on; }).catch(() => {});
  ctx.sheet.open('beds', 'Beds', root, () => {
    unsubscribe();
    ctx.repo.removeEventListener('change', onItems);
    map.off('click', drop);
    map.off('style.load', installBox);
    listener.abort();
    stopDrawing();
    clearBox();
    if (arming) toggleArm();
  });
  sync();
}

function rangeRow(
  label: string,
  min: number,
  max: number,
  step: number,
  onChange: (value: [number, number]) => void,
): { element: HTMLElement; set(value: [number, number]): void } {
  const from = h('input', { type: 'number', class: 'field', inputmode: 'numeric', min: String(min), max: String(max), step: String(step), 'aria-label': `${label} from` });
  const to = h('input', { type: 'number', class: 'field', inputmode: 'numeric', min: String(min), max: String(max), step: String(step), 'aria-label': `${label} to` });
  const read = (): void => {
    let lo = clamp(Number(from.value), min, max);
    let hi = clamp(Number(to.value), min, max);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return;
    if (lo > hi) [lo, hi] = [hi, lo];
    onChange([lo, hi]);
  };
  from.addEventListener('input', read);
  to.addEventListener('input', read);
  const element = h('div', { class: 'bed-range' }, h('span', {}, label), from, to);
  return {
    element,
    set(value) {
      from.value = String(value[0]);
      to.value = String(value[1]);
    },
  };
}

function acreLine(label: string, count: number, total: number, cellM2: number): HTMLElement {
  const acres = count * cellM2 / 4046.8564224;
  const text = acres >= 100 ? `${Math.round(acres).toLocaleString()} ac` : `${acres.toFixed(acres >= 10 ? 0 : 1)} ac`;
  const pct = total ? Math.round(count / total * 100) : 0;
  return h('div', {}, h('span', {}, label), h('span', {}, `${text} · ${pct}%`));
}

function arc(start?: number, end?: number): string {
  if (start === undefined || end === undefined) return '';
  return `${Math.round(start)}–${Math.round(end)}°`;
}

function band(value: [number, number] | undefined, unit: string): string {
  return value ? `${value[0]}–${value[1]}${unit}` : '';
}

function pair(beds: string, land: string): string {
  if (beds && land) return `${beds} · ${land}`;
  return beds || land;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function viewBox(map: MlMap): BBox {
  const bounds = map.getBounds();
  return [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
}
