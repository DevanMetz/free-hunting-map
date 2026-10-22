import { BASEMAP_IDS, BASEMAP_NAMES } from '../map/sources';
import type { AppContext } from './context';
import { h } from './dom';

/** Subset of the PAD-US 4.1 service renderer colors (Mang_Name), read from the service's drawingInfo. */
const PADUS_LEGEND: [string, string][] = [
  ['USFS', '#89bd2a'],
  ['BLM', '#f2dc91'],
  ['NPS', '#70a170'],
  ['FWS', '#ad5764'],
  ['State wildlife', '#a392de'],
  ['State park', '#9baade'],
  ['State trust', '#bf7c99'],
  ['DOD', '#803e39'],
];

export function openLayersPanel(ctx: AppContext, persist: () => void): void {
  const render = (): HTMLElement => {
    const state = ctx.map.mapState;
    return h(
      'div',
      { class: 'form' },
      h(
        'div',
        { class: 'segmented', role: 'radiogroup', 'aria-label': 'Basemap' },
        ...BASEMAP_IDS.map((id) =>
          h(
            'button',
            {
              type: 'button',
              role: 'radio',
              'aria-checked': String(state.basemap === id),
              class: state.basemap === id ? 'selected' : '',
              onclick: () => {
                ctx.map.setBasemap(id);
                persist();
                ctx.sheet.replace(render());
              },
            },
            BASEMAP_NAMES[id],
          ),
        ),
      ),
      h(
        'label',
        { class: 'toggle' },
        h('input', {
          type: 'checkbox',
          checked: state.publicLands,
          onchange: (e: Event) => {
            ctx.map.setPublicLands((e.target as HTMLInputElement).checked);
            persist();
            ctx.sheet.replace(render());
          },
        }),
        h('span', {}, 'Public lands'),
      ),
      state.publicLands
        ? h('ul', { class: 'legend' }, ...PADUS_LEGEND.map(([label, color]) => h('li', {}, h('i', { style: `background:${color}` }), label)))
        : null,
    );
  };
  ctx.sheet.open('layers', 'Layers', render());
}
