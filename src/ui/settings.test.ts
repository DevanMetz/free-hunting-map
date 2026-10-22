import { expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './settings';
it('defaults overlays off while preserving saved toggles', () => {
  expect(DEFAULT_SETTINGS).toMatchObject({ parcels: false, water: false, deerUnits: false });
  expect({ ...DEFAULT_SETTINGS, ...{ water: true } }).toMatchObject({ parcels: false, water: true, deerUnits: false });
});

import { loadSettings } from './settings';
import { PUBLIC_LANDS, publicLandDefaults } from '../map/publicLands';
it('defaults each category off and migrates the legacy toggle', () => {
  expect(loadSettings().publicLand).toEqual(publicLandDefaults());
  expect(loadSettings({ publicLands: true }).publicLand).toEqual(publicLandDefaults(true));
  expect(loadSettings({ publicLands: false }).publicLand).toEqual(publicLandDefaults());
  const state = publicLandDefaults();
  state.usfs = true;
  expect(loadSettings({ publicLands: true, publicLand: state }).publicLand).toEqual(state);
  expect(loadSettings({ publicLands: true })).not.toHaveProperty('publicLands');
  loadSettings().publicLand.usfs = true;
  expect(PUBLIC_LANDS.every(c => !DEFAULT_SETTINGS.publicLand[c.id])).toBe(true);
});
