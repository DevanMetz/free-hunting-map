import { expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './settings';
it('defaults overlays off while preserving saved toggles', () => {
  expect(DEFAULT_SETTINGS).toMatchObject({ parcels: false, water: false, deerUnits: false });
  expect({ ...DEFAULT_SETTINGS, ...{ water: true } }).toMatchObject({ parcels: false, water: true, deerUnits: false });
});
