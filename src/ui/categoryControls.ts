import { useFeature } from '../usage';
import { ICON_STYLE } from '../map/icons';
import { WAYPOINT_ICONS, type Category } from '../types';
import type { AppContext } from './context';
import { h, iconButton, toast } from './dom';

export function categoryDialog(ctx: AppContext, category?: Category, onSave?: (category: Category) => void, focusColor = false): void {
  const name = h('input', { class: 'field', 'aria-label': 'Category name', placeholder: 'Category name', value: category?.name ?? '', maxlength: 120, required: true });
  const color = h('input', { type: 'color', 'aria-label': 'Category color', value: category?.color ?? '#e87826' });
  const icon = h('select', { class: 'field', 'aria-label': 'Category icon' }, h('option', { value: '' }, 'Default icon'),
    ...WAYPOINT_ICONS.filter(i => i !== 'trailcam').map(i => h('option', { value: i }, ICON_STYLE[i].title)));
  icon.value = category?.icon ?? '';
  const dialog = h('dialog', { class: 'organize-dialog', 'aria-label': category ? 'Edit category' : 'New category' });
  const close = (): void => { dialog.close(); dialog.remove(); };
  let saving = false;
  const save = async (): Promise<void> => {
    if (saving || !name.value.trim()) { if (!name.value.trim()) name.reportValidity(); return; }
    saving = true;
    submit.disabled = true;
    try {
      const fields = { color: color.value, icon: icon.value as Category['icon'] || undefined };
      const saved = category ? await ctx.repo.updateCategory(category, { name: name.value.trim(), ...fields }) : await ctx.repo.createCategory(name.value.trim(), fields);
      if (!category) useFeature('category_create');
      onSave?.(saved); close();
    } catch { toast('Could not save category'); }
    finally { saving = false; submit.disabled = false; }
  };
  const submit = h('button', { type: 'submit', class: 'btn primary' }, 'Save');
  dialog.append(h('form', { class: 'form', onsubmit: (e: Event) => { e.preventDefault(); void save(); } },
    h('div', { class: 'actions' }, h('strong', {}, category ? 'Edit category' : 'New category'), iconButton('close', 'Cancel', close)),
    h('div', { class: 'row' }, name, color), icon,
    submit));
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog); dialog.showModal(); (focusColor ? color : name).focus();
}

export function deleteCategoryDialog(ctx: AppContext, category: Category): void {
  const dialog = h('dialog', { class: 'organize-dialog', 'aria-label': 'Delete category' });
  const close = (): void => { dialog.close(); dialog.remove(); };
  let removing = false;
  const remove = async (items: boolean): Promise<void> => {
    if (removing) return;
    removing = true;
    keep.disabled = true; removeItems.disabled = true;
    try { await ctx.repo.removeCategory(category.id, items); close(); }
    catch { toast('Could not delete category'); }
    finally { removing = false; keep.disabled = false; removeItems.disabled = false; }
  };
  const keep = h('button', { type: 'button', class: 'btn', onclick: () => void remove(false) }, 'Keep items in Uncategorized');
  const removeItems = h('button', { type: 'button', class: 'btn danger', onclick: () => void remove(true) }, 'Delete items too');
  dialog.append(h('div', { class: 'form' },
    h('div', { class: 'actions' }, h('strong', {}, `Delete ${category.name}?`), iconButton('close', 'Cancel', close)),
    keep, removeItems));
  dialog.addEventListener('close', () => dialog.remove()); document.body.append(dialog); dialog.showModal();
}

export function categoryPicker(ctx: AppContext, selected: string | undefined, onPick: (id: string | undefined) => void, onReady?: (ready: boolean) => void): HTMLElement {
  const select = h('select', { class: 'field', 'aria-label': 'Category', disabled: true });
  const refresh = async (id?: string): Promise<void> => {
    select.disabled = true; onReady?.(false);
    const categories = await ctx.repo.categories();
    select.replaceChildren(h('option', { value: '' }, 'Uncategorized'), ...categories.map(c => h('option', { value: c.id }, c.name)), h('option', { value: ':new' }, 'New category…'));
    select.value = categories.some(c => c.id === id) ? id! : '';
    select.disabled = false; onReady?.(true);
  };
  void refresh(selected).catch(() => toast('Could not load categories'));
  select.addEventListener('change', () => {
    if (select.value !== ':new') { selected = select.value || undefined; onPick(selected); return; }
    select.value = selected ?? '';
    categoryDialog(ctx, undefined, category => { selected = category.id; void refresh(selected).catch(() => toast('Could not load categories')); onPick(selected); });
  });
  return select;
}

export function moveDialog(ctx: AppContext, ids: string[], onDone: () => void): void {
  let categoryId: string | undefined;
  const dialog = h('dialog', { class: 'organize-dialog', 'aria-label': 'Move items' });
  const close = (): void => { dialog.close(); dialog.remove(); };
  let moving = false;
  const move = async (): Promise<void> => {
    if (moving) return;
    moving = true; submit.disabled = true;
    try {
      for (const id of ids) { const item = await ctx.repo.get(id); if (item && !item.deleted) await ctx.repo.update(item, { categoryId }); }
      useFeature('category_move'); onDone(); close();
    } catch { toast('Could not move all items'); }
    finally { moving = false; submit.disabled = false; }
  };
  const submit = h('button', { type: 'button', class: 'btn primary', disabled: true, onclick: () => void move() }, 'Move');
  dialog.append(h('div', { class: 'form' },
    h('div', { class: 'actions' }, h('strong', {}, 'Move items'), iconButton('close', 'Cancel', close)),
    categoryPicker(ctx, undefined, id => { categoryId = id; }, ready => { submit.disabled = !ready || moving; }),
    submit));
  dialog.addEventListener('close', () => dialog.remove()); document.body.append(dialog); dialog.showModal();
}
