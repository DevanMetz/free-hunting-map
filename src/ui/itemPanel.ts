import { ICON_STYLE, iconSvg } from '../map/icons';
import { formatDistance, formatLatLng, pathLength } from '../map/geo';
import { WAYPOINT_ICONS, type Item, type WaypointIcon } from '../types';
import type { AppContext } from './context';
import { h, iconButton, toast } from './dom';

export function displayName(item: Item): string {
  if (item.name) return item.name;
  return item.kind === 'waypoint' ? ICON_STYLE[item.icon].title : 'Track';
}

/** Icon picker row shared by the waypoint tool and the edit form. */
export function iconPicker(selected: WaypointIcon, onPick: (icon: WaypointIcon) => void): HTMLElement {
  const row = h('div', { class: 'icon-picker', role: 'radiogroup', 'aria-label': 'Icon' });
  const render = (sel: WaypointIcon): void => {
    row.replaceChildren(
      ...WAYPOINT_ICONS.map((icon) =>
        h('button', {
          type: 'button',
          class: `icon-choice${icon === sel ? ' selected' : ''}`,
          role: 'radio',
          'aria-checked': String(icon === sel),
          'aria-label': ICON_STYLE[icon].title,
          title: ICON_STYLE[icon].title,
          html: iconSvg(icon, 34),
          onclick: () => {
            render(icon);
            onPick(icon);
          },
        }),
      ),
    );
  };
  render(selected);
  return row;
}

export function openItemPanel(ctx: AppContext, item: Item): void {
  let icon: WaypointIcon = item.kind === 'waypoint' ? item.icon : 'pin';
  const name = h('input', { type: 'text', class: 'field', placeholder: 'Name', 'aria-label': 'Name', value: item.name, maxlength: 120 });
  const note = h('textarea', { class: 'field', placeholder: 'Note', 'aria-label': 'Note', rows: 3, maxlength: 2000 });
  note.value = item.note;

  const info =
    item.kind === 'waypoint'
      ? formatLatLng(item.coord)
      : (() => {
          const d = formatDistance(pathLength(item.coords));
          return `${d.imperial} · ${d.metric}`;
        })();

  const save = async (): Promise<void> => {
    const current = await ctx.repo.get(item.id);
    if (!current || current.deleted) return;
    const patch = item.kind === 'waypoint' ? { name: name.value.trim(), note: note.value.trim(), icon } : { name: name.value.trim(), note: note.value.trim() };
    await ctx.repo.update(current, patch);
    ctx.sheet.close();
  };

  const remove = async (): Promise<void> => {
    if (!confirm(`Delete ${displayName(item)}?`)) return;
    await ctx.repo.remove(item.id);
    ctx.sheet.close();
  };

  const copy = (): void => {
    void navigator.clipboard?.writeText(info).then(() => toast('Copied'));
  };

  const body = h(
    'div',
    { class: 'form' },
    item.kind === 'waypoint' ? iconPicker(icon, (i) => (icon = i)) : null,
    name,
    note,
    h('div', { class: 'row' }, h('span', { class: 'mono' }, info), item.kind === 'waypoint' ? iconButton('copy', 'Copy coordinates', copy, 'small') : null),
    h(
      'div',
      { class: 'actions' },
      iconButton('trash', 'Delete', () => void remove(), 'danger'),
      h('button', { type: 'button', class: 'btn primary', onclick: () => void save() }, 'Save'),
    ),
  );
  ctx.sheet.open(`item:${item.id}`, item.kind === 'waypoint' ? 'Waypoint' : 'Track', body);
  if (!item.name) name.focus();
}
