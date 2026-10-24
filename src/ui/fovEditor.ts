import { Marker } from 'maplibre-gl';
import { destination, dragEdge, dragTip } from '../map/fov';
import { sanitizeFov } from '../sync/validate';
import type { FieldOfView, Waypoint } from '../types';
import type { AppContext } from './context';
import { h, iconButton, toast } from './dom';

/** A draft preview: only the editor Save writes it through Repo. Markers support mouse + touch. */
export function fovEditor(ctx: AppContext, item: Waypoint, onChange: (fov: FieldOfView) => void): { element: HTMLElement; close(): void } {
  let fov = sanitizeFov(item.fov);
  let disposed = false;
  const markers: Marker[] = [];
  const lifetime = new AbortController();
  const inputs = {} as Record<keyof FieldOfView, HTMLInputElement>;
  const update = (next: FieldOfView): void => {
    if (disposed) return;
    fov = sanitizeFov(next);
    onChange(fov); ctx.map.setFovPreview(item.id, fov, { categoryId: item.categoryId, color: item.color, icon: item.icon });
    for (const key of ['bearing', 'angle', 'range'] as const) inputs[key].value = String(Math.round(fov[key] * 10) / 10);
    markers.forEach((marker, i) => marker.setLngLat(destination(item.coord, fov.bearing + (i === 0 ? 0 : (i === 1 ? -1 : 1) * fov.angle / 2), fov.range)));
  };
  const fields = h('div', { class: 'fov-fields' }, ...([
    ['bearing', 'Bearing °', 0, 360], ['angle', 'Angle °', 10, 120], ['range', 'Range m', 3, 100],
  ] as const).map(([key, label, min, max]) => {
    const input = inputs[key] = h('input', { type: 'number', class: 'field', 'aria-label': label, min, max, step: 1, inputmode: 'decimal', onchange: () => update({ ...fov, [key]: Number(input.value) }) });
    return h('label', {}, label, input);
  }));
  for (const [i, label] of ['Rotate and range', 'Left field of view', 'Right field of view'].entries()) {
    const element = iconButton(i === 0 ? 'compass' : 'next', label, () => {}, 'fov-handle');
    element.style.touchAction = 'none';
    const marker = new Marker({ element, draggable: true, clickTolerance: 3 }).setLngLat(item.coord).addTo(ctx.map.map);
    marker.on('drag', () => {
      const at = marker.getLngLat();
      update(i === 0 ? dragTip(item.coord, [at.lng, at.lat], fov) : dragEdge(item.coord, [at.lng, at.lat], fov));
    });
    element.addEventListener('click', e => e.stopPropagation());
    element.addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      if (i === 0) update({ ...fov, bearing: fov.bearing + (e.key === 'ArrowLeft' ? -5 : e.key === 'ArrowRight' ? 5 : 0), range: fov.range + (e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0) });
      else update({ ...fov, angle: fov.angle + (e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -5 : 5) });
    });
    markers.push(marker);
  }
  const orientation = globalThis.DeviceOrientationEvent as typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> } | undefined;
  let compassTimer = 0;
  if (orientation && (orientation.requestPermission || 'ondeviceorientationabsolute' in window)) {
    const compass = iconButton('compass', 'Use compass', () => void (async () => {
      if (orientation.requestPermission && await orientation.requestPermission() !== 'granted') return;
      const read = (event: DeviceOrientationEvent): void => {
        const heading = (event as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
        if (typeof heading === 'number') update({ ...fov, bearing: heading });
        else if (event.absolute && event.alpha !== null) update({ ...fov, bearing: 360 - event.alpha });
        else return;
        window.removeEventListener('deviceorientation', read); window.removeEventListener('deviceorientationabsolute', read); clearTimeout(compassTimer);
      };
      window.addEventListener('deviceorientation', read, { signal: lifetime.signal });
      window.addEventListener('deviceorientationabsolute', read, { signal: lifetime.signal });
      compassTimer = window.setTimeout(() => { window.removeEventListener('deviceorientation', read); window.removeEventListener('deviceorientationabsolute', read); if (!disposed) toast('Compass unavailable'); }, 8000);
    })().catch(() => toast('Compass unavailable')));
    fields.append(compass);
  }
  update(fov);
  const frame = requestAnimationFrame(() => {
    if (disposed) return;
    const north = destination(item.coord, 0, fov.range), south = destination(item.coord, 180, fov.range);
    const east = destination(item.coord, 90, fov.range), west = destination(item.coord, 270, fov.range);
    const sheetTop = document.getElementById('sheet')?.getBoundingClientRect().top ?? window.innerHeight / 2;
    ctx.map.map.fitBounds([west[0], south[1], east[0], north[1]], {
      maxZoom: 20, duration: 500, absolutePadding: true,
      padding: window.innerWidth >= 760 ? { left: 460, right: 90, top: 60, bottom: 60 } : { left: 44, right: 44, top: 60, bottom: window.innerHeight - sheetTop + 28 },
    });
  });
  return { element: fields, close() { disposed = true; cancelAnimationFrame(frame); lifetime.abort(); clearTimeout(compassTimer); for (const marker of markers) marker.remove(); ctx.map.setFovPreview(); } };
}
