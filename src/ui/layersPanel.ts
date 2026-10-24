import { PUBLIC_LANDS } from '../map/publicLands';
import { LABEL_SCALES } from '../map/labels';
import { BASEMAP_IDS, BASEMAP_NAMES } from '../map/sources';
import type { AppContext } from './context';
import { h } from './dom';

export function openLayersPanel(ctx: AppContext, persist: () => void, openTrailFinder?: () => void): void {
  let active: HTMLButtonElement | null = null;
  const popover = h('div', { class: 'land-info', role: 'tooltip', id: 'public-land-info', hidden: true });
  const close = () => {
    active?.removeAttribute('aria-describedby');
    active = null;
    popover.hidden = true;
  };
  const show = (button: HTMLButtonElement, text: string) => {
    close();
    active = button;
    button.setAttribute('aria-describedby', popover.id);
    popover.textContent = text;
    popover.hidden = false;
    const rect = button.getBoundingClientRect();
    const width = popover.offsetWidth;
    const height = popover.offsetHeight;
    popover.style.left = `${Math.max(8, Math.min(rect.right + 8, window.innerWidth - width - 8))}px`;
    popover.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - height - 8))}px`;
  };
  const outside = (event: Event) => {
    if (!active?.contains(event.target as Node) && !popover.contains(event.target as Node)) close();
  };
  const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
  document.body.append(popover);
  document.addEventListener('pointerdown', outside);
  document.addEventListener('keydown', escape);
  window.addEventListener('resize', close);
  document.addEventListener('scroll', close, true);
  const render = (): HTMLElement => {
    close();
    const state = ctx.map.mapState;
    return h(
      'div',
      { class: 'form' },
      openTrailFinder ? h('button', { type: 'button', class: 'btn', onclick: openTrailFinder }, 'Trail finder') : null,
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
      h('div', { class: 'public-land-group', role: 'group', 'aria-label': 'Public land' }, ...PUBLIC_LANDS.map(category => {
        let touch = false;
        const name = h('button', { type: 'button', class: 'land-name',
          onpointerdown: (event: Event) => { touch = (event as PointerEvent).pointerType === 'touch'; },
          onmouseenter: () => { if (!touch) show(name, category.info); },
          onmouseleave: () => { if (!touch) close(); },
          onfocus: () => { if (!touch) show(name, category.info); },
          onblur: close,
          onclick: () => {
            if (touch) { if (active === name) close(); else show(name, category.info); }
            else show(name, category.info);
          },
        }, category.label);
        return h('div', { class: 'land-row' },
          h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: state.publicLand[category.id],
            'aria-label': category.label, onchange: (event: Event) => {
              ctx.map.setPublicLand(category.id, (event.target as HTMLInputElement).checked);
              persist();
            } }), h('span', { class: 'land-swatch', style: `background:${category.color}` })), name);
      })),
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
      ...([
        ['parcels', 'Parcels', (on: boolean) => ctx.map.setParcels(on)],
        ['water', 'Water', (on: boolean) => ctx.map.setWater(on)],
        ['deerUnits', 'Deer units', (on: boolean) => ctx.map.setDeerUnits(on)],
      ] as const).map(([key, label, set]) => h('label', { class: 'toggle' },
        h('input', { type: 'checkbox', checked: state[key], onchange: (e: Event) => {
          set((e.target as HTMLInputElement).checked); persist(); ctx.sheet.replace(render());
        } }), h('span', {}, label))),
      h('nav', { class: 'policy-links', 'aria-label': 'Policies' },
        h('a', { href: '/privacy' }, 'Privacy'), h('a', { href: '/terms' }, 'Terms')),
    );
  };
  ctx.sheet.open('layers', 'Layers', render(), () => {
    close(); popover.remove();
    document.removeEventListener('pointerdown', outside);
    document.removeEventListener('keydown', escape);
    window.removeEventListener('resize', close);
    document.removeEventListener('scroll', close, true);
  });
}
