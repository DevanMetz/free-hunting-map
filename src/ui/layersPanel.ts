import { privacyBlocked, usageAllowed, setUsageEnabled, useFeature } from '../usage';
import { LABEL_SCALES } from '../map/labels';
import { BASEMAP_IDS, BASEMAP_NAMES } from '../map/sources';
import { categoryState, layerRegistry, layerSetting, layerVariant, orderedLayers, toggleCategory, type LayerDef } from '../map/layerRegistry';
import type { AppContext } from './context';
import { h, iconButton } from './dom';
import { layerState, stateDistance } from './layerStates';

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
    if (def.id === 'public-trails' && on && !was) useFeature('public_trails');
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
  const activeRows = new Map<string, HTMLElement>();
  const move = (def: LayerDef, direction: number) => {
    const ordered = orderedLayers(ctx.map.mapState).filter(d => !d.action && (d.source || d.layerIds?.length));
    const visible = ordered.filter(d => layerSetting(ctx.map.mapState, d).on);
    const index = visible.findIndex(d => d.id === def.id);
    const other = visible[index + direction];
    if (!other) return;
    const a = ordered.indexOf(def), b = ordered.indexOf(other);
    [ordered[a], ordered[b]] = [ordered[b]!, ordered[a]!];
    ctx.map.setLayerOrder(ordered.map(d => d.id)); persist(); refresh();
  };
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
    const ordered = orderedLayers(current).filter(d => !d.action && layerSetting(current, d).on).reverse();
    const movable = ordered.filter(d => d.source || d.layerIds?.length);
    for (const def of ordered) {
      const row = activeRows.get(def.id);
      if (!row) continue;
      const index = movable.indexOf(def);
      const buttons = row.querySelectorAll<HTMLButtonElement>('.active-layer-move');
      if (buttons.length) { buttons[0]!.disabled = index <= 0; buttons[1]!.disabled = index < 0 || index === movable.length - 1; }
      activeList.append(row);
    }
  });

  let center = ctx.map.view().center;
  const displayCategories = () => {
    const all = layerRegistry.categories();
    const ordinary = all.map(c => ({ ...c, layers: c.layers.filter(d => !layerState(d)) })).filter(c => c.layers.length);
    const groups = new Map<string, { id: string; name: string; layers: LayerDef[]; distance: number }>();
    for (const def of layerRegistry.layers()) {
      const state = layerState(def);
      if (!state) continue;
      const id = `state-${state[0]}`;
      let group = groups.get(id);
      if (!group) { group = { id, name: state[1], layers: [], distance: stateDistance(state, center) }; groups.set(id, group); }
      group.layers.push(def);
    }
    return [...ordinary.map(c => ({ ...c, distance: Infinity })), ...[...groups.values()].sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name))];
  };
  let query = '';
  const search = h('input', { type: 'text', class: 'layer-search-input', placeholder: 'Search layers', 'aria-label': 'Search layers', oninput: () => applySearch(), onkeydown: (event: Event) => {
    if ((event as KeyboardEvent).key === 'Escape' && search.value) { event.stopPropagation(); clearSearch(); }
  } });
  const searchClear = iconButton('close', 'Clear search', () => { clearSearch(); search.focus(); });
  const searchBar = h('div', { class: 'layer-search' }, search, searchClear);
  const categories = h('div', { class: 'layer-categories' });
  const empty = h('div', { class: 'layer-search-empty', hidden: true }, 'No layers');
  const searchRows = new Map<string, HTMLElement>();
  const searchCollapsed = new Set<string>();
  const clearSearch = () => { search.value = ''; applySearch(); };
  const applySearch = () => {
    query = search.value.trim().toLowerCase();
    searchCollapsed.clear();
    searchClear.hidden = !search.value;
    let matches = 0;
    for (const category of displayCategories()) {
      const entry = rendered.get(category.id);
      if (!entry) continue;
      let count = 0;
      for (const def of category.layers) {
        const row = searchRows.get(def.id);
        const match = !query || [category.name, layerRegistry.categories().find(c => c.id === def.category)?.name ?? '', def.name, def.id.replace(/-/g, ' '), def.info ?? '', ...(def.variants?.map(v => v.label) ?? [])].some(value => value.toLowerCase().includes(query));
        if (row) row.hidden = !match;
        if (match) count++;
      }
      entry.rows.parentElement!.hidden = count === 0;
      matches += count;
    }
    if (query) { stateRows.hidden = false; stateDisclosure.setAttribute('aria-expanded', 'true'); otherRows.hidden = false; otherDisclosure.setAttribute('aria-expanded', 'true'); }
    stateSection.hidden = !displayCategories().some(c => c.id.startsWith('state-') && !rendered.get(c.id)?.rows.parentElement?.hidden);
    otherSection.hidden = ![...otherRows.children].some(el => !(el as HTMLElement).hidden);
    empty.hidden = !query || matches > 0;
    refresh();
  };
  const stateRows = h('div', { class: 'state-layer-rows' });
  const stateDisclosure = iconButton('next', 'State layers', () => { stateRows.hidden = !stateRows.hidden; stateDisclosure.setAttribute('aria-expanded', String(!stateRows.hidden)); }, 'category-disclosure');
  stateDisclosure.setAttribute('aria-expanded', 'true');
  const nearbyRows = h('div');
  const otherRows = h('div', { hidden: true });
  const otherDisclosure = iconButton('next', 'Other states', () => { otherRows.hidden = !otherRows.hidden; otherDisclosure.setAttribute('aria-expanded', String(!otherRows.hidden)); }, 'category-disclosure');
  otherDisclosure.setAttribute('aria-expanded', 'false');
  const otherSection = h('section', { class: 'layer-category' }, h('div', { class: 'layer-category-head' }, otherDisclosure, h('span', { class: 'category-name' }, 'Other states')), otherRows);
  stateRows.append(nearbyRows, otherSection);
  const stateSection = h('section', { class: 'layer-category', 'aria-label': 'State' }, h('div', { class: 'layer-category-head' }, stateDisclosure, h('span', { class: 'category-name' }, 'State')), stateRows);
  const rendered = new Map<string, { rows: HTMLElement; update: () => void }>();
  const renderedLayers = new Set<string>();
  const renderEntries = () => {
    for (const category of displayCategories()) {
      let entry = rendered.get(category.id);
      if (!entry) {
        const rows = h('div', { id: `layer-category-${category.id}`, class: 'layer-category-rows' });
        const count = h('span', { class: 'layer-count', 'aria-hidden': 'true' });
        const disclosure = iconButton('next', `${category.name} layers`, () => {
          if (query) { if (rows.hidden) searchCollapsed.delete(category.id); else searchCollapsed.add(category.id); }
          else { ctx.map.setCategoryCollapsed(category.id, !rows.hidden); persist(); }
          close(); refresh();
        }, 'category-disclosure');
        disclosure.setAttribute('aria-controls', rows.id);
        const name = h('span', { class: 'category-name' }, category.name);
        const master = h('button', { type: 'button', class: 'category-switch', role: 'checkbox', 'aria-label': `Toggle ${category.name}`, onclick: () => {
          const defs = displayCategories().find(c => c.id === category.id)?.layers ?? [];
          const state = ctx.map.mapState;
          const key = defs[0]?.category;
          if (!key) return;
          const isolated = { ...state, remembered: { ...state.remembered, [key]: state.remembered[category.id] ?? [] } };
          const changes = toggleCategory(defs, isolated);
          ctx.map.setCategoryRemembered(category.id, isolated.remembered[key] ?? []);
          for (const [id, on] of Object.entries(changes)) set(layerRegistry.get(id)!, on);
          persist(); refresh();
        } });
        const section = h('section', { class: 'layer-category', 'aria-label': category.name },
          h('div', { class: 'layer-category-head' }, disclosure, name, count, master), rows);
        const update = () => {
          const state = current;
          const defs = displayCategories().find(c => c.id === category.id)?.layers ?? [];
          rows.hidden = query ? searchCollapsed.has(category.id) : (state.collapsed[category.id] ?? (category.id.startsWith('state-') ? (displayCategories().find(c => c.id === category.id)?.distance ?? Infinity) > 2.5 : category.id !== 'terrain'));
          disclosure.setAttribute('aria-expanded', String(!rows.hidden));
          master.hidden = defs.every(d => d.action);
          master.setAttribute('aria-checked', categoryState(defs, state));
          const n = defs.filter(d => !d.action && layerSetting(state, d).on).length;
          count.textContent = n ? String(n) : '';
        };
        entry = { rows, update }; rendered.set(category.id, entry); updates.push(update);
        (category.id.startsWith('state-') ? nearbyRows : categories).append(section);
      }
      for (const def of category.layers) {
        if (renderedLayers.has(def.id)) continue;
        renderedLayers.add(def.id);
        if (def.action) {
          const action = h('button', { type: 'button', class: 'btn layer-action', disabled: !openTrailFinder, onclick: () => openTrailFinder?.() }, def.name);
          searchRows.set(def.id, action); entry.rows.append(action);
          continue;
        }
        const input = h('input', { type: 'checkbox', role: 'switch', 'aria-label': def.name, onchange: () => change(def, input.checked) });
        const extra = h('div', { class: 'layer-extra', hidden: true });
        let initialized = false;
        const slider = h('input', { type: 'range', min: 0, max: 1, step: 0.01, 'aria-label': `${def.name} opacity`, oninput: () => {
          ctx.map.setLayerOpacity(def.id, Number(slider.value)); persist();
        } });
        const variants = def.variants ? h('select', { 'aria-label': `${def.name} variant`, onchange: () => {
          ctx.map.setLayerVariant(def.id, variants!.value); persist(); refresh();
        } }, ...def.variants.map(v => h('option', { value: v.id }, v.label))) : null;
        const info = def.info ? iconButton('info', `${def.name} info`, () => show(info!, def.info!)) : null;
        const row = h('div', { class: 'data-layer', 'data-layer': def.id },
          h('div', { class: 'data-layer-main' }, h('label', { class: 'layer-toggle' }, input,
            def.swatch ? h('span', { class: 'land-swatch', style: `background:${def.swatch}` }) : null,
            h('span', { class: 'layer-name' }, def.name)), info), extra);
        const up = iconButton('prev', `Move ${def.name} up`, () => move(def, 1), 'active-layer-move move-up');
        const down = iconButton('next', `Move ${def.name} down`, () => move(def, -1), 'active-layer-move move-down');
        const off = iconButton('close', `Turn off ${def.name}`, () => change(def, false));
        const quick = h('div', { class: 'active-layer-row' }, h('span', { class: 'active-layer-name' }, def.name),
          ...(def.source || def.layerIds?.length ? [up, down] : []), off);
        activeRows.set(def.id, quick); activeList.append(quick);
        updates.push(() => {
          const value = layerSetting(current, def);
          input.checked = value.on; extra.hidden = !value.on; quick.hidden = !value.on;
          slider.value = String(value.opacity);
          if (variants) variants.value = layerVariant(def, value.variant)!.id;
          if (value.on && !initialized) {
            initialized = true; if (variants) extra.append(variants); extra.append(slider);
            if (typeof def.legend === 'string') extra.append(h('img', { class: 'layer-legend-image', src: def.legend, alt: `${def.name} legend`, loading: 'lazy' }));
            else if (def.legend) extra.append(h('div', { class: 'layer-legend', 'aria-label': `${def.name} legend` }, ...def.legend.map(s =>
              h('span', {}, h('i', { style: `background:${s.color}`, 'aria-hidden': 'true' }), s.label))));
          }
        });
        searchRows.set(def.id, row); entry.rows.append(row);
      }
    }
    // Category order remains stable even when a module registers after panel open.
    const ordered = displayCategories();
    const closest = ordered.find(c => c.id.startsWith('state-'))?.id;
    for (const category of ordered) {
      const target = category.id.startsWith('state-') ? (category.id === closest || category.distance <= 2.5 ? nearbyRows : otherRows) : categories;
      target.append(rendered.get(category.id)!.rows.parentElement!);
    }
    categories.prepend(stateSection);
    applySearch();
  };
  renderEntries();
  const unsubscribe = layerRegistry.subscribe(renderEntries);
  const moved = () => { center = ctx.map.view().center; renderEntries(); };
  ctx.map.map.on('moveend', moved);
  const sharing = h('input', { type: 'checkbox', role: 'switch', checked: true, disabled: true, 'aria-label': 'Share scan results', onchange: () => { void ctx.repo.setCommunitySharing(sharing.checked); } });
  void ctx.repo.communitySharing().then(on => { sharing.checked = on; sharing.disabled = false; }).catch(() => {});
  const root = h('div', { class: 'layers-panel' }, searchBar, basemaps, labelControls, activeBar, activeList, categories, empty,
    h('footer', { class: 'layers-footer' },
      h('label', { class: 'layer-toggle' }, sharing, 'Share scan results'),
      h('label', { class: 'layer-toggle' }, h('input', { type: 'checkbox', role: 'switch', checked: usageAllowed(), disabled: privacyBlocked(), onchange: (e: Event) => setUsageEnabled((e.target as HTMLInputElement).checked) }), 'Usage analytics'),
      h('nav', { class: 'policy-links', 'aria-label': 'Site' }, h('a', { href: '/features' }, 'Features'), h('a', { href: '/privacy' }, 'Privacy'), h('a', { href: '/terms' }, 'Terms'))));
  ctx.sheet.open('layers', 'Layers', root, () => {
    unsubscribe(); ctx.map.map.off('moveend', moved); close(); popover.remove();
    document.removeEventListener('pointerdown', outside);
    document.removeEventListener('keydown', escape);
    window.removeEventListener('resize', close);
    document.removeEventListener('scroll', close, true);
  });
}
