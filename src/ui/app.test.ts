// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './app';
import { loadSettings, type Settings } from './settings';
import { Repo } from '../storage/repo';
import { Sheet } from './sheet';
import { layerRegistry } from '../map/layerRegistry';
import { wp } from '../test/fixtures';
import type { TypeVisibility } from '../organize/model';
const popupCreated = vi.hoisted(() => vi.fn());
vi.mock('maplibre-gl', () => ({ setWorkerUrl: vi.fn(), Popup: class {
  constructor() { popupCreated(); }
  on() { return this; }
  isOpen() { return false; }
  setLngLat() { return this; }
  setDOMContent() { return this; }
  addTo() { return this; }
  remove() {}
} }));

vi.mock('maplibre-gl/dist/maplibre-gl-worker.mjs?url', () => ({ default: '' }));

it('keeps a local visibility edit when an older preference read completes later', async () => {
  const repo = await Repo.open(crypto.randomUUID());
  const state = loadSettings();
  const old = structuredClone(state);
  await repo.setMeta('settings', old);
  const map = {
    get mapState() { return structuredClone(state); },
    view: () => state.view,
    setTypeVisibility: (patch: Partial<TypeVisibility>) => Object.assign(state, patch),
    setBasemap: vi.fn(), setLabels: vi.fn(), setLabelScale: vi.fn(), setLayer: vi.fn(),
    setLayerOpacity: vi.fn(), setCategoryCollapsed: vi.fn(), setCategoryRemembered: vi.fn(),
  };
  const app = Object.assign(Object.create(App.prototype), { repo, map, preferenceVersion: 0 }) as Pick<App, 'setTypeVisibility'> & { applyPreferences(): Promise<void> };
  let release!: (value: Settings) => void;
  vi.spyOn(repo, 'getMeta').mockReturnValueOnce(new Promise<Settings>(resolve => { release = resolve; }));
  const pending = app.applyPreferences();
  await app.setTypeVisibility({ showRecordings: false });
  release(old); await pending;
  expect(state.showRecordings).toBe(false);
  expect(await repo.getMeta('settings')).toMatchObject({ showRecordings: false });
  await Promise.all([app.setTypeVisibility({ showPins: false }), app.setTypeVisibility({ showTrails: false })]);
  expect(await repo.getMeta('settings')).toMatchObject({ showPins: false, showTrails: false, showRecordings: false });
});

afterEach(() => { vi.restoreAllMocks(); popupCreated.mockClear(); });
function identifySetup() {
  const state = loadSettings({ layers: { 'public-trails': { on: true, opacity: 1 }, 'deer-units': { on: true, opacity: 1 } } });
  const root = document.createElement('section'), sheet = new Sheet(root);
  const trail: Record<string, unknown> = { type: 'foot', name: 'Forest Loop', uses: 'Hike', agency: 'USFS', src: 'usfs_trails' };
  const query = vi.fn((_box, { layers }: { layers: string[] }) => layers.includes('public-trails-foot') ? [{ properties: trail }] : []);
  const map = { mapState: state, map: { getZoom: () => 12, getLayer: () => ({}), queryRenderedFeatures: query } };
  const area = vi.spyOn(layerRegistry.get('deer-units')!, 'identify').mockResolvedValue({ title: 'Deer unit', rows: [] });
  const app = Object.assign(Object.create(App.prototype), { map, sheet, liveItems: [], tool: null, buttons: new Map(), recorder: { active: false } });
  const e = { point: { x: 100, y: 100 }, lngLat: { lng: -90, lat: 44 } };
  return { app, e, root, state, query, area };
}
it('gives tools and saved items priority over registered trail identification', () => {
  const { app, e, query } = identifySetup();
  const tool = { onMapClick: vi.fn() }; app.tool = tool;
  app.onMapClick(e); expect(tool.onMapClick).toHaveBeenCalledWith([-90, 44]); expect(query).not.toHaveBeenCalled();
  app.tool = null; const item = wp(); app.liveItems = [item]; app.openItem = vi.fn();
  query.mockReturnValueOnce([{ properties: { id: item.id } }]);
  app.onMapClick(e); expect(app.openItem).toHaveBeenCalledWith(item); expect(query).toHaveBeenCalledOnce();
});
it('opens the registered trail sheet before inspecting area layers', async () => {
  const { app, e, root, area, query } = identifySetup();
  app.onMapClick(e);
  await vi.waitFor(() => expect(app.sheet.current).toBe('public-trails'));
  expect(root.querySelector('h2')?.textContent).toBe('Forest Loop');
  expect(query).toHaveBeenLastCalledWith([[84, 84], [116, 116]], expect.objectContaining({ layers: expect.arrayContaining(['public-trails-foot']) }));
  expect(area).not.toHaveBeenCalled(); expect(popupCreated).not.toHaveBeenCalled();
});
it('falls back to existing area inspection on a trail miss, and skips disabled or out-of-range trails', async () => {
  for (const mode of ['miss', 'disabled', 'zoom']) {
    const { app, e, area, state, query } = identifySetup();
    query.mockReturnValue([]);
    if (mode === 'disabled') state.layers['public-trails']!.on = false;
    if (mode === 'zoom') app.map.map.getZoom = () => 7;
    app.onMapClick(e); await vi.waitFor(() => expect(area).toHaveBeenCalled());
    expect(app.sheet.current).toBeNull();
    expect(query.mock.calls.length).toBe(mode === 'miss' ? 3 : mode === 'disabled' ? 2 : 1);
    vi.restoreAllMocks();
  }
});
it('discards a pending sheet result when a tool takes over', async () => {
  const { app, e } = identifySetup();
  let resolve!: (value: { title: string; rows: [] }) => void;
  vi.spyOn(layerRegistry.get('public-trails')!, 'identify').mockReturnValue(new Promise(done => { resolve = done; }));
  app.onMapClick(e); app.setTool({ key: 'measure' });
  resolve({ title: 'Late trail', rows: [] }); await Promise.resolve(); await Promise.resolve();
  expect(app.sheet.current).toBeNull(); expect(popupCreated).not.toHaveBeenCalled();
});
