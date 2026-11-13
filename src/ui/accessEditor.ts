import { accessStore, PRESSURE_LABEL, PRESSURE_LEVELS, type PressureLevel, type Pullout } from '../map/access/store';
import { fmtDateTime, h, toast } from './dom';

function reports(spotId: string): HTMLElement {
  const list = h('ul', { class: 'pressure-log' });
  const render = (): void => {
    const items = accessStore?.reportsFor(spotId).slice(0, 8) ?? [];
    list.replaceChildren(...items.map(item => h('li', {}, `${PRESSURE_LABEL[item.level]} · ${fmtDateTime(item.at)}`)));
    list.hidden = items.length === 0;
  };
  render();
  const onChange = (): void => {
    if (!list.isConnected) { accessStore?.removeEventListener('change', onChange); return; }
    render();
  };
  accessStore?.addEventListener('change', onChange);
  return list;
}

export function pressureControls(spotId: string): HTMLElement {
  const buttons = PRESSURE_LEVELS.map(level => h('button', {
    type: 'button', class: 'btn', 'aria-pressed': 'false',
    onclick: () => accessStore?.addReport(spotId, level),
  }, PRESSURE_LABEL[level]));
  const paint = (): void => {
    const latest = accessStore?.reportsFor(spotId)[0]?.level;
    PRESSURE_LEVELS.forEach((level, index) => buttons[index]?.setAttribute('aria-pressed', String(latest === level)));
  };
  paint();
  const onChange = (): void => {
    if (!buttons[0]?.isConnected) { accessStore?.removeEventListener('change', onChange); return; }
    paint();
  };
  accessStore?.addEventListener('change', onChange);
  return h('div', { class: 'community-vote' }, h('div', { class: 'community-vote-buttons pressure-levels' }, ...buttons), reports(spotId));
}

function field(label: string, value: string, max: number, onInput: (value: string) => void): HTMLInputElement {
  const input = h('input', { type: 'text', class: 'field', placeholder: label, 'aria-label': label, value, maxlength: max });
  input.addEventListener('input', () => onInput(input.value));
  return input;
}

export function pulloutForm(id: string): HTMLElement {
  const item = accessStore?.pullout(id);
  const write = (patch: Partial<Pick<Pullout, 'name' | 'capacity' | 'gate' | 'boulders' | 'note'>>): void => {
    accessStore?.updatePullout(id, patch);
  };
  const current = item ?? { name: '', capacity: '', gate: '', boulders: '', note: '' };
  return h('div', { class: 'form access-pullout' },
    field('Name', current.name, 120, name => write({ name })),
    field('Capacity', current.capacity, 200, capacity => write({ capacity })),
    field('Gate', current.gate, 200, gate => write({ gate })),
    field('Boulders', current.boulders, 200, boulders => write({ boulders })),
    field('Note', current.note, 500, note => write({ note })),
    pressureControls(`pullout:${id}`),
    h('button', { type: 'button', class: 'btn danger', onclick: () => {
      if (!confirm('Delete pullout?')) return;
      accessStore?.deletePullout(id);
      toast('Pullout deleted');
    } }, 'Delete'),
  );
}

export type { PressureLevel };
