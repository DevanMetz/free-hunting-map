import type { LngLat } from '../types';
import { restrictionWarnings } from '../map/rules/registry';
import '../map/rules/wisconsin';
import { toast } from './dom';

/** Best-effort notice after a pin is saved. Offline or an empty hit stays quiet. */
export function warnAboutRestrictions(coord: LngLat): void {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 8000);
  void restrictionWarnings(coord[0], coord[1], controller.signal).then(lines => {
    if (lines.length) toast(lines.slice(0, 2).join(' '), 7000, 'warn');
  }).catch(() => {}).finally(() => window.clearTimeout(timer));
}
