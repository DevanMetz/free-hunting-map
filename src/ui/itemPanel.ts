import { categoryPicker } from './categoryControls';
import { fovEditor } from './fovEditor';
import { sanitizeFov } from '../sync/validate';
import { useFeature } from '../usage';
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
  let categoryId = item.categoryId;
  let color = item.color;
  let iconOverride = item.iconOverride;
  let fov = item.kind === 'waypoint' ? item.fov : undefined;
  let cameraEditor: ReturnType<typeof fovEditor> | undefined;
  let icon: WaypointIcon = item.kind === 'waypoint' ? item.icon : 'pin';
  const name = h('input', { type: 'text', class: 'field', placeholder: 'Name', 'aria-label': 'Name', value: item.name, maxlength: 120 });
  const note = h('textarea', { class: 'field', placeholder: 'Note', 'aria-label': 'Note', rows: 3, maxlength: 2000 });
  note.value = item.note;

  const camera = h('input', { type: 'text', class: 'field', placeholder: 'Camera model', 'aria-label': 'Camera model', value: item.kind === 'waypoint' ? item.camera ?? '' : '', maxlength: 120 });
  const dateField = (label: string, timestamp?: number): HTMLInputElement => h('input', { type: 'date', class: 'field', 'aria-label': label, value: timestamp === undefined ? '' : new Date(timestamp).toISOString().slice(0, 10) });
  const setAt = dateField('Date set', item.kind === 'waypoint' ? item.setAt : undefined);
  const checkedAt = dateField('Last checked', item.kind === 'waypoint' ? item.checkedAt : undefined);
  const cameraBody = h('div', { class: 'form' });
  const cameraDetails = h('div', { class: 'form' });
  const updateCamera = (): void => {
    cameraEditor?.close(); cameraEditor = undefined;
    cameraBody.replaceChildren(); cameraDetails.replaceChildren();
    if (item.kind !== 'waypoint' || icon !== 'trailcam') return;
    cameraEditor = fovEditor(ctx, { ...item, icon, color, categoryId, fov: sanitizeFov(fov) }, next => { fov = next; });
    cameraBody.append(cameraEditor.element);
    cameraDetails.append(camera, h('div', { class: 'date-fields' }, h('label', {}, 'Date set', setAt), h('label', {}, 'Last checked', checkedAt)));
  };
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
    const common = { name: name.value.trim(), note: note.value.trim(), categoryId, color };
    const patch = item.kind === 'waypoint' ? { ...common, icon, iconOverride, ...(icon === 'trailcam' ? { fov: sanitizeFov(fov), camera: camera.value.trim(), setAt: setAt.value ? new Date(`${setAt.value}T12:00:00`).getTime() : undefined, checkedAt: checkedAt.value ? new Date(`${checkedAt.value}T12:00:00`).getTime() : undefined } : {}) } : common;
    await ctx.repo.update(current, patch);
    if (categoryId !== item.categoryId) useFeature('category_move');
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
    item.kind === 'waypoint' ? iconPicker(icon, (i) => { icon = i; iconOverride = true; updateCamera(); }) : null,
    name,
    categoryPicker(ctx, categoryId, id => { categoryId = id; updateCamera(); }),
    cameraBody,
    h('details', { class: 'item-details', open: item.kind !== 'waypoint' || item.icon !== 'trailcam' || window.innerWidth >= 760 }, h('summary', {}, 'Details'), h('div', { class: 'form' }, cameraDetails, note,
    h('div', { class: 'row item-appearance' },
      h('label', { class: 'row' }, 'Color', h('input', { type: 'color', 'aria-label': 'Item color', value: color ?? '#e87826', onchange: (e: Event) => { color = (e.target as HTMLInputElement).value; updateCamera(); } })),
      h('button', { type: 'button', class: 'btn', onclick: () => { color = undefined; iconOverride = false; icon = 'pin'; if (item.kind === 'waypoint' && item.icon === 'trailcam') icon = 'trailcam'; updateCamera(); } }, 'Use category style')),
    h('div', { class: 'row' }, h('span', { class: 'mono' }, info), item.kind === 'waypoint' ? iconButton('copy', 'Copy coordinates', copy) : null))),
    h(
      'div',
      { class: 'actions' },
      iconButton('trash', 'Delete', () => void remove(), 'danger'),
      h('button', { type: 'button', class: 'btn primary', onclick: () => void save() }, 'Save'),
    ),
  );
  ctx.sheet.open(`item:${item.id}`, item.kind === 'waypoint' ? 'Waypoint' : 'Track', body, () => cameraEditor?.close());
  updateCamera();
  if (!item.name && (item.kind !== 'waypoint' || item.icon !== 'trailcam' || window.innerWidth >= 760)) name.focus();
}
