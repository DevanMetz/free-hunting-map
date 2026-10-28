import { formatLatLng, parseLatLng } from '../map/geo';
import { coordinatesFromUrl } from '../share/takeout/coordinates';
import type { LngLat } from '../types';
import type { AppContext } from './context';
import { h, iconButton, toast } from './dom';

export function readLocation(input: string): LngLat | null {
  const fromUrl = coordinatesFromUrl(input);
  if (fromUrl) return fromUrl;
  if (/https?:/i.test(input)) return null;
  return parseLatLng(input);
}

export function openGoTo(ctx: AppContext): void {
  const input = h('input', {
    type: 'text',
    class: 'field go-to-input',
    autocomplete: 'off',
    spellcheck: 'false',
    autocapitalize: 'off',
    autocorrect: 'off',
    enterkeyhint: 'go',
    'aria-label': 'Latitude, longitude',
    value: formatLatLng(ctx.map.view().center),
  });
  const go = (): void => {
    const parsed = readLocation(input.value);
    if (!parsed) {
      toast('Could not read coordinates');
      input.focus();
      return;
    }
    const zoom = Math.max(ctx.map.map.getZoom(), 15);
    ctx.sheet.close();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) ctx.map.map.jumpTo({ center: parsed, zoom });
    else ctx.map.map.flyTo({ center: parsed, zoom });
  };
  const copy = (): void => {
    const parsed = readLocation(input.value);
    const text = parsed ? formatLatLng(parsed) : '';
    if (!text) {
      toast('Could not read coordinates');
      return;
    }
    void navigator.clipboard?.writeText(text).then(() => toast('Copied')).catch(() => toast('Could not copy'));
  };
  let selectOnFocus = true;
  input.addEventListener('focus', () => {
    if (!selectOnFocus) return;
    selectOnFocus = false;
    input.select();
  });
  ctx.sheet.open('goto', 'Coordinates', h(
    'form',
    { class: 'form', onsubmit: (event: Event) => { event.preventDefault(); go(); } },
    input,
    h('div', { class: 'actions' }, iconButton('copy', 'Copy coordinates', copy), h('button', { type: 'submit', class: 'btn primary' }, 'Go')),
  ));
  input.focus();
}
