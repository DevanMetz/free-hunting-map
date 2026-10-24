import { privacyBlocked, usageAllowed, setUsageEnabled, useFeature } from '../usage';
import { LABEL_SCALES } from '../map/labels';
import { BASEMAP_IDS, BASEMAP_NAMES } from '../map/sources';
import { categoryState, layerRegistry, layerSetting, toggleCategory, type LayerDef } from '../map/layerRegistry';
import type { AppContext } from './context';
import { h, iconButton } from './dom';

export function openLayersPanel(ctx: AppContext, persist: () => void, openTrailFinder?: () => void): void {
  let active: HTMLButtonElement | null = null;
  const popover = h('div', { class: 'land-info', role: 'tooltip', id: 'public-land-info', hidden: true });
  const close = () => {
    active?.removeAttribute('aria-describedby');
    active = null;
    popover.hidden = true;
  };
  const show = (button: HTMLButtonElement, text: string) => {
    if (active === button) { close(); return; }
    close(); active = button;
    button.setAttribute('aria-describedby', popover.id);
    popover.textContent = text; popover.hidden = false;
    const rect = button.getBoundingClientRect();
    popover.style.left = `${Math.max(8, Math.min(rect.right + 8, window.innerWidth - popover.offsetWidth - 8))}px`;
    popover.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - popover.offsetHeight - 8))}px`;
  };
  const outside = (event: Event) => { if (!active?.contains(event.target as Node) && !popover.contains(event.target as Node)) close(); };
  const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
  document.body.append(popover);
  document.addEventListener('pointerdown', outside);
  document.addEventListener('keydown', escape);
  window.addEventListener('resize', close);
  document.addEventListener('scroll', close, true);

  const updates: (() => void)[] = [];
  let current = ctx.map.mapState;
  const refresh = () => { current = ctx.map.mapState; for (const update of updates) update(); };
  const set = (def: LayerDef, on: boolean) => {
    const was = layerSetting(ctx.map.mapState, def).on;
    ctx.map.setLayer(def.id, on);
    if (on && !was) useFeature('data_layer');
    useFeature('layer_toggle');
    if (def.id === 'public-trails') useFeature('public_trails');
  };
  const change = (def: LayerDef, on: boolean) => { set(def, on); persist(); refresh(); };
  const basemaps = h('div', { class: 'basemap-row', role: 'radiogroup', 'aria-label': 'Basemap' });
  for (const id of BASEMAP_IDS) {
    const button = h('button', { type: 'button', role: 'radio', class: 'basemap-thumb',
      onclick: () => { ctx.map.setBasemap(id); useFeature('basemap_change'); persist(); refresh(); } },
    h('img', { src: `/basemaps/${id}.webp`, alt: '', width: 96, height: 52 }), h('span', {}, BASEMAP_NAMES[id]));
    updates.push(() => button.setAttribute('aria-checked', String(current.basemap === id)));
    basemaps.append(button);
  }
  const labels = h('input', { type: 'checkbox', role: 'switch', 'aria-label': 'Labels', onchange: () => {
    ctx.map.setLabels(labels.checked); useFeature('layer_toggle'); persist(); refresh();
  } });
  const sizes = h('div', { class: 'label-sizes', role: 'radiogroup', 'aria-label': 'Label size' });
  for (const size of LABEL_SCALES) {
    const button = h('button', { type: 'button', role: 'radio', 'aria-label': size.name, title: size.name,
      style: `font-size:${size.fontSize}px`, onclick: () => { ctx.map.setLabelScale(size.scale); persist(); refresh(); } }, 'A');
    updates.push(() => button.setAttribute('aria-checked', String(current.labelScale === size.scale)));
    sizes.append(button);
  }
  const labelControls = h('div', { class: 'label-controls' }, h('label', { class: 'layer-toggle' }, labels, 'Labels'), sizes);
  updates.push(() => {
    const state = current;
    labelControls.hidden = state.basemap === 'streets'; labels.checked = state.labels;
    sizes.hidden = !state.labels;
  });

  const activeList = h('div', { class: 'active-layers' });
  const activeButton = h('button', { type: 'button', class: 'active-chip', 'aria-expanded': 'false', 'aria-controls': 'active-layer-list', onclick: () => {
    activeList.hidden = !activeList.hidden; activeButton.setAttribute('aria-expanded', String(!activeList.hidden));
  } });
  activeList.id = 'active-layer-list'; activeList.hidden = true;
  const clear = h('button', { type: 'button', class: 'clear-layers', onclick: () => {
    const state = ctx.map.mapState;
    for (const category of layerRegistry.categories()) {
      const enabled = category.layers.filter(d => !d.action && layerSetting(state, d).on);
      if (enabled.length) ctx.map.setCategoryRemembered(category.id, enabled.map(d => d.id));
      for (const def of enabled) set(def, false);
    }
    persist(); refresh();
  } }, 'Clear all');
  const activeBar = h('div', { class: 'active-layer-bar' }, activeButton, clear);
  updates.push(() => {
    const count = layerRegistry.layers().filter(d => !d.action && layerSetting(current, d).on).length;
    activeButton.textContent = `Active (${count})`; clear.disabled = count === 0;
  });

  const categories = h('div', { class: 'layer-categories' });
  const rendered = new Map<string, { rows: HTMLElement; update: () => void }>();
  const renderedLayers = new Set<string>();
  const renderEntries = () => {
    for (const category of layerRegistry.categories()) {
      let entry = rendered.get(category.id);
      if (!entry) {
        const rows = h('div', { id: `layer-category-${category.id}`, class: 'layer-category-rows' });
        const count = h('span', { class: 'layer-count', 'aria-hidden': 'true' });
        const disclosure = iconButton('next', `${category.name} layers`, () => {
          ctx.map.setCategoryCollapsed(category.id, !rows.hidden); close(); persist(); refresh();
        }, 'category-disclosure');
        disclosure.setAttribute('aria-controls', rows.id);
        const name = h('span', { class: 'category-name' }, category.name);
        const master = h('button', { type: 'button', class: 'category-switch', role: 'checkbox', 'aria-label': `Toggle ${category.name}`, onclick: () => {
          const defs = layerRegistry.layers().filter(d => d.category === category.id);
          const state = ctx.map.mapState;
          const changes = toggleCategory(defs, state);
          ctx.map.setCategoryRemembered(category.id, state.remembered[category.id] ?? []);
          for (const [id, on] of Object.entries(changes)) set(layerRegistry.get(id)!, on);
          persist(); refresh();
        } });
        const section = h('section', { class: 'layer-category', 'aria-label': category.name },
          h('div', { class: 'layer-category-head' }, disclosure, name, count, master), rows);
        const update = () => {
          const state = current;
          const defs = layerRegistry.layers().filter(d => d.category === category.id);
          rows.hidden = state.collapsed[category.id] ?? category.id !== 'terrain';
          disclosure.setAttribute('aria-expanded', String(!rows.hidden));
          master.hidden = defs.every(d => d.action);
          master.setAttribute('aria-checked', categoryState(defs, state));
          const n = defs.filter(d => !d.action && layerSetting(state, d).on).length;
          count.textContent = n ? String(n) : '';
        };
        entry = { rows, update }; rendered.set(category.id, entry); updates.push(update);
        categories.append(section);
      }
      for (const def of category.layers) {
        if (renderedLayers.has(def.id)) continue;
        renderedLayers.add(def.id);
        if (def.action) {
          entry.rows.append(h('button', { type: 'button', class: 'btn layer-action', disabled: !openTrailFinder, onclick: () => openTrailFinder?.() }, def.name));
          continue;
        }
        const input = h('input', { type: 'checkbox', role: 'switch', 'aria-label': def.name, onchange: () => change(def, input.checked) });
        const extra = h('div', { class: 'layer-extra', hidden: true });
        let initialized = false;
        const slider = h('input', { type: 'range', min: 0, max: 1, step: 0.01, 'aria-label': `${def.name} opacity`, oninput: () => {
          ctx.map.setLayerOpacity(def.id, Number(slider.value)); persist();
        } });
        const info = def.info ? iconButton('info', `${def.name} info`, () => show(info!, def.info!)) : null;
        const row = h('div', { class: 'data-layer', 'data-layer': def.id },
          h('div', { class: 'data-layer-main' }, h('label', { class: 'layer-toggle' }, input,
            def.swatch ? h('span', { class: 'land-swatch', style: `background:${def.swatch}` }) : null,
            h('span', { class: 'layer-name' }, def.name)), info), extra);
        const quick = h('button', { type: 'button', class: 'active-layer-off', 'aria-label': `Turn off ${def.name}`, onclick: () => change(def, false) }, def.name, h('span', { 'aria-hidden': 'true' }, '×'));
        activeList.append(quick);
        updates.push(() => {
          const value = layerSetting(current, def);
          input.checked = value.on; extra.hidden = !value.on; quick.hidden = !value.on;
          slider.value = String(value.opacity);
          if (value.on && !initialized) {
            initialized = true; extra.append(slider);
            if (typeof def.legend === 'string') extra.append(h('img', { class: 'layer-legend-image', src: def.legend, alt: `${def.name} legend`, loading: 'lazy' }));
            else if (def.legend) extra.append(h('div', { class: 'layer-legend', 'aria-label': `${def.name} legend` }, ...def.legend.map(s =>
              h('span', {}, h('i', { style: `background:${s.color}`, 'aria-hidden': 'true' }), s.label))));
          }
        });
        entry.rows.append(row);
      }
    }
    // Category order remains stable even when a module registers after panel open.
    for (const category of layerRegistry.categories()) categories.append(rendered.get(category.id)!.rows.parentElement!);
    refresh();
  };
  renderEntries();
  const unsubscribe = layerRegistry.subscribe(renderEntries);
  const root = h('div', { class: 'layers-panel' }, basemaps, labelControls, activeBar, activeList, categories,
    h('footer', { class: 'layers-footer' },
      h('label', { class: 'layer-toggle' }, h('input', { type: 'checkbox', role: 'switch', checked: usageAllowed(), disabled: privacyBlocked(), onchange: (e: Event) => setUsageEnabled((e.target as HTMLInputElement).checked) }), 'Usage analytics'),
      h('nav', { class: 'policy-links', 'aria-label': 'Site' }, h('a', { href: '/features' }, 'Features'), h('a', { href: '/privacy' }, 'Privacy'), h('a', { href: '/terms' }, 'Terms'))));
  ctx.sheet.open('layers', 'Layers', root, () => {
    unsubscribe(); close(); popover.remove();
    document.removeEventListener('pointerdown', outside);
    document.removeEventListener('keydown', escape);
    window.removeEventListener('resize', close);
    document.removeEventListener('scroll', close, true);
  });
}
