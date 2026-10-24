// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { App } from './app';
import { loadSettings, type Settings } from './settings';
import { Repo } from '../storage/repo';
import type { TypeVisibility } from '../organize/model';
vi.mock('maplibre-gl', () => ({ setWorkerUrl: vi.fn() }));

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
