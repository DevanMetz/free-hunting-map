import type { IdentifyResult } from '../map/layerRegistry';
import type { Sheet } from './sheet';
import { h } from './dom';

export function openIdentifyPanel(sheet: Sheet, key: string, result: IdentifyResult): void {
  sheet.open(key, result.title ?? '', h('dl', { class: 'identify-details' },
    ...result.rows.flatMap(([label, value]) => [h('dt', {}, label), h('dd', {}, value)])));
}
