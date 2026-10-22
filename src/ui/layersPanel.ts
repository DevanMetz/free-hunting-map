import { LABEL_SCALES } from '../map/labels';
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
      state.basemap !== 'streets'
        ? h(
            'label',
            { class: 'toggle' },
            h('input', {
              type: 'checkbox',
              checked: state.labels,
              onchange: (e: Event) => {
                ctx.map.setLabels((e.target as HTMLInputElement).checked);
                persist();
                ctx.sheet.replace(render());
              },
            }),
            h('span', {}, 'Labels'),
          )
        : null,
      state.basemap !== 'streets' && state.labels
        ? h(
            'div',
            { class: 'segmented', role: 'radiogroup', 'aria-label': 'Label size' },
            ...LABEL_SCALES.map(({ id, scale, name, fontSize }) => h(
              'button',
              {
                type: 'button',
                id: `label-size-${id}`,
                role: 'radio',
                'aria-label': name,
                title: name,
                'aria-checked': String(state.labelScale === scale),
                class: state.labelScale === scale ? 'selected' : '',
                style: `font-size:${fontSize}px`,
                onclick: () => {
                  ctx.map.setLabelScale(scale);
                  persist();
                  ctx.sheet.replace(render());
                },
              },
              'A',
            )),
          )
        : null,
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
      h(
        'label',
        { class: 'toggle' },
        h('input', {
          type: 'checkbox',
          checked: state.hillshade,
          onchange: (e: Event) => {
            ctx.map.setHillshade((e.target as HTMLInputElement).checked);
            persist();
            ctx.sheet.replace(render());
          },
        }),
        h('span', {}, 'Hillshade'),
      ),
    );
  };
  ctx.sheet.open('layers', 'Layers', render());
}
