import { BASEMAP_IDS, BASEMAP_NAMES } from '../map/sources';
import { useFeature } from '../usage';
import type { AppContext } from './context';
import { h } from './dom';

/** One control on the map that cycles Topo, Satellite, and Streets. The picture is the basemap the next tap selects. */
export function mountBasemapSwitch(ctx: AppContext, corner: HTMLElement, persist: () => void): void {
  const img = h('img', { alt: '', width: 44, height: 44 });
  const button = h('button', { type: 'button' }, img);
  const sync = (): void => {
    const index = BASEMAP_IDS.indexOf(ctx.map.mapState.basemap);
    const next = BASEMAP_IDS[(index + 1) % BASEMAP_IDS.length] ?? 'topo';
    img.src = `/basemaps/${next}.webp`;
    img.style.objectPosition = next === 'streets' ? '0% 50%' : '50% 50%';
    const name = BASEMAP_NAMES[next];
    button.setAttribute('aria-label', `Switch to ${name}`);
    button.title = name;
  };
  button.addEventListener('click', () => {
    const index = BASEMAP_IDS.indexOf(ctx.map.mapState.basemap);
    const next = BASEMAP_IDS[(index + 1) % BASEMAP_IDS.length];
    if (!next || next === ctx.map.mapState.basemap) return;
    ctx.map.setBasemap(next);
    useFeature('basemap_change');
    persist();
    sync();
  });
  ctx.map.map.on('style.load', sync);
  sync();
  corner.prepend(h('div', { class: 'maplibregl-ctrl maplibregl-ctrl-group basemap-switch' }, button));
}
