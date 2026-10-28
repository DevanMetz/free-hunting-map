import { useFeature } from '../usage';
import { iconSvg } from '../map/icons';
import { categoryOf, effectiveColor, effectiveIcon, isVisible, itemType, type ItemType } from '../organize/model';
import { matchRanges, searchItems } from '../organize/search';
import type { Category, Item } from '../types';
import type { AppContext } from './context';
import { h, iconButton, toast } from './dom';
import { displayName } from './itemDisplay';
import { categoryDialog, deleteCategoryDialog, moveDialog } from './categoryControls';

export function openListPanel(ctx: AppContext): void {
  let items: Item[] = [], categories: Category[] = [], type: ItemType | undefined, categoryId: string | undefined;
  let selecting = false, searched = false, deleting = false, version = 0, closed = false;
  const selected = new Set<string>(), collapsed = new Set<string>();
  const search = h('input', { type: 'search', class: 'field', placeholder: 'Search', 'aria-label': 'Search saved items', autocomplete: 'off' });
  const filters = h('div', { class: 'organize-filters' });
  filters.addEventListener('wheel', e => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { filters.scrollLeft += e.deltaY; e.preventDefault(); } });
  const groups = h('div', { class: 'organize-groups' });
  const bulk = h('div', { class: 'organize-bulk', hidden: true });
  let allButton = iconButton('eye', 'Hide all items', () => {});
  const selectButton = iconButton('check', 'Select items', () => { selecting = !selecting; selected.clear(); render(); });
  const categoryFilter = h('select', { class: 'chip category-filter', 'aria-label': 'Filter category', onchange: () => { categoryId = categoryFilter.value === ':all' ? undefined : categoryFilter.value; render(); } });
  const setHidden = async (ids: string[], hidden: boolean): Promise<void> => {
    for (const id of ids) { const item = await ctx.repo.get(id); if (item && !item.deleted) await ctx.repo.update(item, { hidden }); }
    await refresh();
  };
  const allVisibility = async (hidden: boolean): Promise<void> => {
    for (const c of categories) if (c.hidden !== hidden) await ctx.repo.updateCategory(c, { hidden });
    await setHidden(items.map(i => i.id), hidden);
    await ctx.setTypeVisibility({ showPins: !hidden, showTrails: !hidden, showRecordings: !hidden });
    await refresh();
  };
  const render = (): void => {
    selectButton.classList.toggle('active', selecting);
    selectButton.setAttribute('aria-pressed', String(selecting));
    const shown = ctx.visibility(), cams = items.filter(i => itemType(i) === 'trailcam');
    const camsShown = shown.showPins && (!cams.length || cams.some(i => !i.hidden));
    const anyShown = items.some(i => isVisible(i, categories, shown));
    allButton.replaceWith(allButton = iconButton(anyShown ? 'eye' : 'eyeOff', `${anyShown ? 'Hide' : 'Show'} all items`, () => void allVisibility(anyShown), anyShown ? '' : 'is-off'));
    filters.replaceChildren(categoryFilter, ...([
      ['pin', 'Pins', shown.showPins, () => ctx.setTypeVisibility({ showPins: !shown.showPins })],
      ['trail', 'Trails', shown.showTrails, () => ctx.setTypeVisibility({ showTrails: !shown.showTrails })],
      ['recording', 'Recordings', shown.showRecordings, () => ctx.setTypeVisibility({ showRecordings: !shown.showRecordings })],
      ['trailcam', 'Trail cams', camsShown, async () => {
        await setHidden(cams.map(i => i.id), camsShown);
        if (!camsShown && !shown.showPins) await ctx.setTypeVisibility({ showPins: true });
      }],
    ] as const).map(([key, label, on, toggle]) => h('div', { class: `type-chip${type === key ? ' active' : ''}${on ? '' : ' is-off'}` },
      h('button', { type: 'button', class: 'chip', 'aria-pressed': String(type === key), onclick: () => { type = type === key ? undefined : key; render(); } }, label),
      iconButton(on ? 'eye' : 'eyeOff', `${on ? 'Hide' : 'Show'} all ${label.toLowerCase()}`, () => void toggle().then(refresh)),
    )));
    categoryFilter.replaceChildren(h('option', { value: ':all' }, 'All categories'), h('option', { value: '' }, 'Uncategorized'), ...categories.map(c => h('option', { value: c.id }, c.name)));
    categoryFilter.value = categoryId ?? ':all';
    categoryFilter.classList.toggle('active', categoryFilter.value !== ':all');
    const result = searchItems(items, categories, search.value, { type, categoryId });
    bulk.hidden = !selecting;
    bulk.replaceChildren(h('span', { class: 'selected-count', role: 'status' }, String(selected.size)),
      h('button', { type: 'button', class: 'btn', disabled: !selected.size, onclick: () => moveDialog(ctx, [...selected], () => { selected.clear(); void refresh(); }) }, 'Move'),
      iconButton('eyeOff', 'Hide selected', () => void setHidden([...selected], true)),
      iconButton('eye', 'Show selected', () => void setHidden([...selected], false)),
      iconButton('trash', 'Delete selected', () => void (async () => {
        if (deleting || !selected.size || !confirm(`Delete ${selected.size} items?`)) return;
        const ids = [...selected];
        deleting = true;
        render();
        try {
          for (const id of ids) { await ctx.repo.remove(id); selected.delete(id); }
          await refresh();
        } catch {
          toast('Could not delete all selected items');
        } finally {
          deleting = false;
          if (!closed) render();
        }
      })(), 'danger'));
    (bulk.lastElementChild as HTMLButtonElement).disabled = deleting || !selected.size;
    if (search.value.trim()) groups.replaceChildren(h('ul', { class: 'item-list', 'aria-label': 'Search results' }, ...result.map(row)));
    else {
      const visibleGroups: (Category | undefined)[] = [...categories, undefined].filter(c => categoryId === undefined || (c?.id ?? '') === categoryId);
      groups.replaceChildren(...visibleGroups.map(category => {
        const id = category?.id ?? '', name = category?.name ?? 'Uncategorized';
        const members = result.filter(i => (categoryOf(i, categories)?.id ?? '') === id);
        const list = h('ul', { class: 'item-list', hidden: collapsed.has(id) }, ...members.map(row));
        const menu = h('div', { class: 'category-menu', hidden: true });
        if (category) menu.append(...['Rename', 'Recolor', 'Icon', 'Delete'].map(action => h('button', { type: 'button', class: 'btn', onclick: () => {
          menu.hidden = true;
          if (action === 'Delete') deleteCategoryDialog(ctx, category);
          else categoryDialog(ctx, category, undefined, action === 'Recolor');
        } }, action)));
        const eye = category ? iconButton(category.hidden ? 'eyeOff' : 'eye', `${category.hidden ? 'Show' : 'Hide'} category ${name}`, () => void ctx.repo.updateCategory(category, { hidden: !category.hidden }).then(() => { useFeature('category_hide'); void refresh(); }))
          : iconButton(members.length && members.every(i => i.hidden) ? 'eyeOff' : 'eye', `${members.length && members.every(i => i.hidden) ? 'Show' : 'Hide'} Uncategorized`, () => void setHidden(members.map(i => i.id), !members.every(i => i.hidden)));
        const off = category ? category.hidden : members.length > 0 && members.every(i => i.hidden);
        return h('section', { class: `category-group${off ? ' is-hidden' : ''}`, 'data-category': id },
          h('div', { class: 'category-head' },
            h('button', { type: 'button', class: 'category-name', 'aria-expanded': String(!collapsed.has(id)), onclick: () => { collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id); render(); } },
              h('span', { class: 'category-dot', style: `background:${category?.color ?? '#9fb0a2'}` }), h('span', { class: 'category-title' }, name), h('span', { class: 'category-count' }, String(members.length))),
            eye, category ? iconButton('more', `Category menu ${name}`, () => { menu.hidden = !menu.hidden; }) : null), menu, list);
      }));
    }
    if (!result.length && search.value.trim()) groups.append(h('div', { class: 'empty', role: 'status' }, 'No results'));
  };
  const row = (item: Item): HTMLElement => {
    const hidden = !isVisible(item, categories, ctx.visibility());
    const glyph = item.kind === 'waypoint' ? h('span', { class: 'glyph', html: iconSvg(effectiveIcon(item, categories), 26, effectiveColor(item, categories)) }) : h('span', { class: 'glyph track-glyph', style: `background:${effectiveColor(item, categories)}` });
    const open = async (): Promise<void> => { const revealed = await ctx.revealItem(item); focusItem(ctx, revealed); ctx.openItem(revealed); };
    const checkbox = selecting ? h('label', { class: 'selection-target' }, h('input', { type: 'checkbox', 'aria-label': `Select ${displayName(item)}`, checked: selected.has(item.id), onchange: (e: Event) => { (e.target as HTMLInputElement).checked ? selected.add(item.id) : selected.delete(item.id); render(); } })) : null;
    const button = h('button', { type: 'button', class: 'item-row', 'aria-label': `Open ${displayName(item)}`, onclick: () => {
      if (selecting) { selected.has(item.id) ? selected.delete(item.id) : selected.add(item.id); render(); } else void open();
    } }, glyph, highlighted(displayName(item), search.value));
    return h('li', { class: `organized-item${hidden ? ' is-hidden' : ''}`, 'data-item-id': item.id }, checkbox, button,
      iconButton(hidden ? 'eyeOff' : 'eye', `${hidden ? 'Show' : 'Hide'} ${displayName(item)}`, () => void (hidden ? ctx.revealItem(item).then(refresh) : setHidden([item.id], true))));
  };
  async function refresh(): Promise<void> {
    const v = ++version;
    const data = await Promise.all([ctx.repo.list(), ctx.repo.categories()]);
    if (closed || v !== version) return;
    [items, categories] = data;
    for (const id of selected) if (!items.some(i => i.id === id)) selected.delete(id);
    render();
  }
  search.addEventListener('input', () => { if (search.value.trim() && !searched) { searched = true; useFeature('search'); } render(); });
  const onChange = (): void => { void refresh(); };
  ctx.repo.addEventListener('change', onChange); ctx.repo.addEventListener('preferences', onChange);
  const body = h('div', { class: 'organize' },
    h('div', { class: 'organize-search row' }, search, allButton, iconButton('plus', 'New category', () => categoryDialog(ctx)), selectButton),
    filters, bulk, groups);
  ctx.sheet.open('list', 'Organize', body, () => { closed = true; ctx.repo.removeEventListener('change', onChange); ctx.repo.removeEventListener('preferences', onChange); });
  void refresh();
}

function highlighted(text: string, query: string): HTMLElement {
  const span = h('span', { class: 'name' });
  let end = 0;
  for (const [a, b] of matchRanges(text, query)) { span.append(document.createTextNode(text.slice(end, a)), h('mark', {}, text.slice(a, b))); end = b; }
  span.append(document.createTextNode(text.slice(end))); return span;
}

export function focusItem(ctx: AppContext, item: Item): void {
  if (item.kind === 'waypoint') {
    const camera = item.icon === 'trailcam';
    ctx.map.map.flyTo({ center: item.coord, zoom: Math.max(ctx.map.map.getZoom(), camera ? 19 : 15), padding: window.innerWidth >= 760 ? { left: 420, right: 70, top: 20, bottom: 20 } : { left: 20, right: 20, top: 20, bottom: Math.min(window.innerHeight * 0.55, 480) } });
    return;
  }
  if (item.coords.length < 2) return;
  let [minX, minY, maxX, maxY] = [180, 90, -180, -90];
  for (const [x, y] of item.coords) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  ctx.map.map.fitBounds([minX, minY, maxX, maxY], { padding: 60, maxZoom: 16 });
}
