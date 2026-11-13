import { WIND_DIRS, type WindDir } from '../types';
import { h } from './dom';
import { sortWinds } from '../stands/winds';

/** Compass multi-select or single-select. No caption; the letters are the control. */
export function windPicks(
  label: string,
  multi: boolean,
  selected: readonly WindDir[],
  onChange: (next: WindDir[]) => void,
): HTMLElement & { set(next: readonly WindDir[]): void } {
  const row = h('div', { class: 'wind-picks', role: multi ? 'group' : 'radiogroup', 'aria-label': label });
  let current = sortWinds(selected);
  const draw = (): void => {
    row.replaceChildren(...WIND_DIRS.map(dir => h('button', {
      type: 'button',
      'aria-pressed': current.includes(dir) ? 'true' : 'false',
      'aria-label': dir,
      onclick: () => {
        const next = multi ? (current.includes(dir) ? current.filter(item => item !== dir) : [...current, dir]) : [dir];
        current = sortWinds(next);
        draw();
        onChange(current);
      },
    }, dir)));
  };
  draw();
  return Object.assign(row, {
    set(next: readonly WindDir[]) {
      current = sortWinds(next);
      draw();
    },
  });
}
