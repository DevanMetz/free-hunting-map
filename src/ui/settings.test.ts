import { expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings } from './settings';
import { PUBLIC_LANDS, publicLandDefaults } from '../map/publicLands';
it('defaults community layers and public land on, with other overlays off and fresh state per load', () => {
  const state = loadSettings();
  const defaultsOn = new Set(['my-items', 'community-trails', 'community-hikes', ...PUBLIC_LANDS.map(c => `padus-${c.id}`)]);
  expect(Object.entries(state.layers).filter(([id]) => !defaultsOn.has(id)).every(([, v]) => !v.on)).toBe(true);
  for (const id of defaultsOn) expect(state.layers[id]!.on).toBe(true);
  expect(loadSettings({ layers: { 'padus-usfs': { on: false, opacity: 1 } } }).layers['padus-usfs']!.on).toBe(false);
  expect(loadSettings({ publicLands: false }).layers['padus-blm']!.on).toBe(false);
  state.layers.hillshade!.on = true; expect(loadSettings().layers.hillshade!.on).toBe(false);
  expect(DEFAULT_SETTINGS.layers).toEqual({});
});
it('migrates old toggles including water to both layers and individual public land choices', () => {
  const saved = loadSettings({ publicLands: true, hillshade: true, parcels: true, water: true, deerUnits: true });
  for (const c of PUBLIC_LANDS) expect(saved.layers[`padus-${c.id}`]!.on).toBe(true);
  for (const id of ['hillshade', 'parcels', 'water-nhd', 'water-nwi', 'deer-units']) expect(saved.layers[id]!.on).toBe(true);
  expect(saved).not.toHaveProperty('water'); expect(saved).not.toHaveProperty('publicLands');
  const publicLand = { ...publicLandDefaults(), usfs: true };
  const individual = loadSettings({ publicLands: true, publicLand });
  expect(PUBLIC_LANDS.filter(c => individual.layers[`padus-${c.id}`]!.on).map(c => c.id)).toEqual(['usfs']);
});
it('new state wins over legacy and retains unknown IDs and category memories', () => {
  const saved = loadSettings({ water: true, layers: { 'water-nhd': { on: false, opacity: 0.4 }, future: { on: true, opacity: 0.6 } }, collapsed: { water: true }, remembered: { terrain: ['future'] } });
  expect(saved.layers['water-nhd']).toEqual({ on: false, opacity: 0.4 });
  expect(saved.layers.future).toEqual({ on: true, opacity: 0.6 });
  expect(saved.collapsed).toEqual({ water: true }); expect(saved.remembered.terrain).toEqual(['future']);
  expect(loadSettings(saved)).toEqual(saved);
});
it('clamps persisted opacity and label sizes', () => {
  const state = loadSettings({ layers: { future: { on: true, opacity: 3 }, slope: { on: true, opacity: NaN } }, labelScale: 100 });
  expect(state.layers.future!.opacity).toBe(1); expect(state.layers.slope!.opacity).toBe(0.65);
  expect(state.labelScale).toBeLessThan(100);
});

it('migrates the original trails toggle, preferring registry state when present', () => {
  expect(loadSettings().layers['public-trails']).toEqual({ on: false, opacity: 1 });
  expect(loadSettings({ trails: true }).layers['public-trails']!.on).toBe(true);
  const saved = loadSettings({ trails: true, layers: { 'public-trails': { on: false, opacity: 0.7 } } });
  expect(saved.layers['public-trails']).toEqual({ on: false, opacity: 0.7 });
  expect(saved).not.toHaveProperty('trails'); expect(loadSettings(saved)).toEqual(saved);
});
