import { ICON_STYLE, iconSvg } from '../map/icons';
import { WAYPOINT_ICONS, type Item, type WaypointIcon } from '../types';
import { h } from './dom';

export function displayName(item: Item): string {
  if (item.name) return item.name;
  return item.kind === 'waypoint' ? ICON_STYLE[item.icon].title : 'Track';
}

/** Icon picker row shared by the waypoint tool and the edit form. */
export function iconPicker(selected: WaypointIcon, onPick: (icon: WaypointIcon) => void): HTMLElement & { select(icon: WaypointIcon): void } {
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
  return Object.assign(row, { select: render });
}

