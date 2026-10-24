import { expect, it } from 'vitest';
import { LayerRegistry, categoryState, toggleCategory, type LayerDef, type LayerPreferences } from './layerRegistry';
const def = (id: string, category: LayerDef['category'] = 'land'): LayerDef => ({ id, category, name: id, defaultOpacity: 0.7, attribution: '' });
it('orders categories and preserves registration order within them, omitting empty categories', () => {
  const r = new LayerRegistry();
  r.registerLayers([def('slope', 'terrain'), def('usfs'), def('blm'), def('water', 'water')]);
  expect(r.layers().map(d => d.id)).toEqual(['usfs', 'blm', 'water', 'slope']);
  expect(r.categories().map(c => c.id)).toEqual(['land', 'water', 'terrain']);
  expect(() => r.registerLayer(def('usfs'))).toThrow('already registered');
  expect(() => r.registerLayer({ ...def('bad'), defaultOpacity: NaN })).toThrow('opacity');
});
it('publishes late registrations and exposes declarative cache routes without DOM dependencies', () => {
  const r = new LayerRegistry(); let calls = 0;
  const unsubscribe = r.subscribe(() => calls++);
  const route = /^https:\/\/example.com\//;
  r.registerLayer({ ...def('new'), cacheRoute: route });
  expect(r.get('new')?.id).toBe('new'); expect(calls).toBe(1);
  expect(r.cacheRoutes()).toEqual([route]); unsubscribe(); r.registerLayer(def('later')); expect(calls).toBe(1);
});
it('cycles mixed categories off and restores their remembered set, falling back to all', () => {
  const defs = [def('a'), def('b'), def('c')];
  const state: LayerPreferences = { layers: {}, collapsed: {}, remembered: {} };
  const apply = () => { for (const [id, on] of Object.entries(toggleCategory(defs, state))) state.layers[id] = { on, opacity: 0.7 }; };
  expect(categoryState(defs, state)).toBe('false'); apply(); expect(categoryState(defs, state)).toBe('true');
  state.layers.b!.on = false; expect(categoryState(defs, state)).toBe('mixed'); apply();
  expect(state.remembered.land).toEqual(['a', 'c']); expect(categoryState(defs, state)).toBe('false'); apply();
  expect(state.layers.b!.on).toBe(false); expect(categoryState(defs, state)).toBe('mixed');
  state.remembered.land = ['unregistered']; for (const v of Object.values(state.layers)) v.on = false; apply();
  expect(categoryState(defs, state)).toBe('true');
});
it('excludes actions from master toggles', () => {
  const action: LayerDef = { ...def('find', 'trailfinder'), action: 'trailfinder' };
  const state: LayerPreferences = { layers: {}, collapsed: {}, remembered: {} };
  expect(toggleCategory([action], state)).toEqual({}); expect(categoryState([action], state)).toBe('false');
});

it('keeps live feed routes out of the default CacheFirst imagery cache', () => {
  const registry = new LayerRegistry();
  const live = /^https:\/\/example.com\/current\?/;
  const imagery = /^https:\/\/example.com\/raster\?/;
  registry.registerLayers([
    { ...def('fire', 'hazards'), cacheRoute: live, cacheStrategy: 'NetworkFirst' },
    { ...def('cover', 'vegetation'), cacheRoute: imagery },
  ]);
  expect(registry.cacheRoutes()).toEqual([imagery]);
  expect(registry.cacheRoutes('NetworkFirst')).toEqual([live]);
});
