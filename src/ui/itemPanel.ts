import { SCOUT_SHARES } from '../scout/grid';
import { shrinkPhoto } from '../scout/photo';
import { partyShareControl } from './partyPanel';
import { hikeShareControl } from './hikeShare';
import { categoryPicker } from './categoryControls';
import { fovEditor } from './fovEditor';
import { sanitizeFov } from '../sync/validate';
import { useFeature } from '../usage';
import { displayName, iconPicker } from './itemDisplay';
import { formatDistance, formatLatLng, pathLength } from '../map/geo';
import { type Item, type WaypointIcon } from '../types';
import type { AppContext } from './context';
import { copyText, h, iconButton, toast } from './dom';
import { warnAboutRestrictions } from './restrictionWarning';

export function openItemPanel(ctx: AppContext, item: Item): void {
  let categoryId = item.categoryId;
  let color = item.color;
  let iconOverride = item.iconOverride;
  let fov = item.kind === 'waypoint' ? item.fov : undefined;
  let sex = item.kind === 'waypoint' ? item.sex : undefined;
  let seenAt = item.kind === 'waypoint' ? item.seenAt : undefined;
  let photo = item.kind === 'waypoint' ? item.photo : undefined;
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
  const sightingBody = h('div', { class: 'form' });
  const party = item.kind === 'waypoint' ? partyShareControl(ctx, item.id, () => icon) : undefined;
  const updateCamera = (): void => {
    cameraEditor?.close(); cameraEditor = undefined;
    cameraBody.replaceChildren(); cameraDetails.replaceChildren(); sightingBody.replaceChildren();
    if (item.kind === 'waypoint' && (icon === 'deer' || icon === 'trailcam')) {
      if (icon === 'deer') {
        const sexSelect = h('select', { class: 'field', 'aria-label': 'Sex', onchange: (e: Event) => { const value = (e.target as HTMLSelectElement).value; sex = value === 'buck' || value === 'doe' ? value : undefined; } },
          h('option', { value: '' }, ''),
          h('option', { value: 'buck', ...(sex === 'buck' ? { selected: true } : {}) }, 'Buck'),
          h('option', { value: 'doe', ...(sex === 'doe' ? { selected: true } : {}) }, 'Doe'));
        const when = h('input', { type: 'datetime-local', class: 'field', 'aria-label': 'Seen', value: seenAt ? localStamp(seenAt) : '', onchange: (e: Event) => { const value = (e.target as HTMLInputElement).value; const parsed = value ? new Date(value).getTime() : NaN; seenAt = Number.isFinite(parsed) ? parsed : undefined; } });
        sightingBody.append(sexSelect, when);
      }
      const file = h('input', { type: 'file', accept: 'image/*', class: 'field', 'aria-label': 'Photo', onchange: () => {
        const picked = file.files?.[0];
        if (!picked) return;
        void shrinkPhoto(picked).then(url => {
          if (!url) { toast('Photo too large'); return; }
          photo = url;
          updateCamera();
        }).catch(() => toast('Photo too large'));
      } });
      sightingBody.append(file);
      if (photo) sightingBody.append(h('img', { class: 'sighting-photo', alt: '', src: photo }));
    }
    party?.refresh();
    if (item.kind !== 'waypoint' || icon !== 'trailcam') return;
    cameraEditor = fovEditor(ctx, { ...item, icon, color, categoryId, fov: sanitizeFov(fov) }, next => { fov = next; });
    cameraBody.append(cameraEditor.element);
    cameraDetails.append(camera, h('div', { class: 'date-fields' }, h('label', {}, 'Date set', setAt), h('label', {}, 'Last checked', checkedAt)));
  };
  const info =
    item.kind === 'waypoint'
      ? formatLatLng(item.coord)
      : (() => {
          const d = formatDistance(pathLength(item.coords, item.segments));
          return `${d.imperial} · ${d.metric}`;
        })();

  let busy = false;
  const save = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      const current = await ctx.repo.get(item.id);
      if (!current || current.deleted) return;
      const common = { name: name.value.trim(), note: note.value.trim(), categoryId, color };
      const patch = item.kind === 'waypoint' ? { ...common, icon, iconOverride, sex: icon === 'deer' ? sex : undefined, seenAt: icon === 'deer' ? seenAt : undefined, photo: icon === 'deer' || icon === 'trailcam' ? photo : undefined, ...(icon === 'trailcam' ? { fov: sanitizeFov(fov), camera: camera.value.trim(), setAt: setAt.value ? new Date(`${setAt.value}T12:00:00`).getTime() : undefined, checkedAt: checkedAt.value ? new Date(`${checkedAt.value}T12:00:00`).getTime() : undefined } : {}) } : common;
      if (item.kind === 'waypoint') {
        const links = await ctx.repo.getMeta<Record<string, string[]>>(SCOUT_SHARES) ?? {};
        const selected = party?.selected() ?? [];
        if (selected.length) links[item.id] = selected;
        else delete links[item.id];
        await ctx.repo.setMeta(SCOUT_SHARES, links);
      }
      await ctx.repo.update(current, patch);
      if (current.kind === 'waypoint') warnAboutRestrictions(current.coord);
      if (categoryId !== item.categoryId) useFeature('category_move');
      if (body.isConnected) ctx.sheet.close();
    } catch { toast('Could not save item'); }
    finally { busy = false; }
  };

  const remove = async (): Promise<void> => {
    if (busy || !confirm(`Delete ${displayName(item)}?`)) return;
    busy = true;
    try {
      await ctx.repo.remove(item.id);
      if (body.isConnected) ctx.sheet.close();
    } catch { toast('Could not delete item'); }
    finally { busy = false; }
  };

  const copy = (): void => {
    void copyText(info);
  };

  const title = (): string => item.kind === 'track' ? 'Track' : icon === 'trailcam' ? 'Trail cam' : icon === 'deer' ? 'Deer' : icon === 'scrape' ? 'Scrape' : icon === 'rub' ? 'Rub' : icon === 'stand' ? 'Stand' : 'Waypoint';
  const picker = item.kind === 'waypoint' ? iconPicker(icon, (i) => { icon = i; iconOverride = true; updateCamera(); ctx.sheet.setTitle(title()); }) : null;
  const hikeShare = item.kind === 'track' && item.recorded ? hikeShareControl(ctx, item) : undefined;
  const body = h(
    'div',
    { class: 'form item-editor' },
    picker,
    h('div', { class: 'item-identity' }, name, categoryPicker(ctx, categoryId, id => { categoryId = id; updateCamera(); })),
    cameraBody,
    sightingBody,
    party?.element,
    hikeShare?.element,
    h('details', { class: 'item-details', open: item.kind !== 'waypoint' || item.icon !== 'trailcam' || window.innerWidth >= 760 }, h('summary', {}, 'Details'), h('div', { class: 'form' }, cameraDetails, note,
    h('div', { class: 'row item-appearance' },
      h('label', { class: 'row' }, 'Color', h('input', { type: 'color', 'aria-label': 'Item color', value: color ?? '#e87826', onchange: (e: Event) => { color = (e.target as HTMLInputElement).value; updateCamera(); } })),
      h('button', { type: 'button', class: 'btn', onclick: () => { color = undefined; iconOverride = false; icon = 'pin'; if (item.kind === 'waypoint' && item.icon === 'trailcam') icon = 'trailcam'; picker?.select(icon); ctx.sheet.setTitle(title()); updateCamera(); } }, 'Use category style')),
    h('div', { class: 'row' }, h('span', { class: 'mono' }, info), item.kind === 'waypoint' ? iconButton('copy', 'Copy coordinates', copy) : null))),
    h(
      'div',
      { class: 'actions' },
      iconButton('trash', 'Delete', () => void remove(), 'danger'),
      h('button', { type: 'button', class: 'btn primary', onclick: () => void save() }, 'Save'),
    ),
  );
  ctx.sheet.open(`item:${item.id}`, title(), body, () => { cameraEditor?.close(); hikeShare?.close(); });
  updateCamera();
  if (!item.name && (item.kind !== 'waypoint' || item.icon !== 'trailcam' || window.innerWidth >= 760)) name.focus();
}

function localStamp(ms: number): string {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
