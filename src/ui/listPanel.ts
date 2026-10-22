import { iconSvg } from '../map/icons';
import { pathLength, shortDistance } from '../map/geo';
import type { Item } from '../types';
import type { AppContext } from './context';
import { h } from './dom';
import { displayName } from './itemPanel';

export function openListPanel(ctx: AppContext): void {
  const render = (): HTMLElement => {
    const items = [...ctx.items()].sort((a, b) => b.updatedAt - a.updatedAt);
    if (!items.length) return h('div', { class: 'empty' }, '—');
    return h('ul', { class: 'item-list' }, ...items.map((item) => row(ctx, item)));
  };
  const container = h('div', {}, render());
  const onChange = (): void => container.replaceChildren(render());
  ctx.repo.addEventListener('change', onChange);
  ctx.sheet.open('list', 'Saved', container, () => ctx.repo.removeEventListener('change', onChange));
}

function row(ctx: AppContext, item: Item): HTMLElement {
  const glyph =
    item.kind === 'waypoint'
      ? h('span', { class: 'glyph', html: iconSvg(item.icon, 28) })
      : h('span', { class: `glyph track-glyph${item.recorded ? ' recorded' : ''}` });
  const meta = item.kind === 'track' ? h('span', { class: 'meta' }, shortDistance(pathLength(item.coords))) : null;
  return h(
    'li',
    {},
    h(
      'button',
      {
        type: 'button',
        class: 'item-row',
        onclick: () => {
          focusItem(ctx, item);
          ctx.openItem(item);
        },
      },
      glyph,
      h('span', { class: 'name' }, displayName(item)),
      meta,
    ),
  );
}

export function focusItem(ctx: AppContext, item: Item): void {
  if (item.kind === 'waypoint') {
    ctx.map.map.flyTo({ center: item.coord, zoom: Math.max(ctx.map.map.getZoom(), 15) });
    return;
  }
  if (item.coords.length < 2) return;
  let [minX, minY, maxX, maxY] = [180, 90, -180, -90];
  for (const [x, y] of item.coords) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  ctx.map.map.fitBounds([minX, minY, maxX, maxY], { padding: 60, maxZoom: 16 });
}
