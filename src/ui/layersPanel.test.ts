// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { useFeature } from '../usage';
import { openLayersPanel } from './layersPanel';
import { Sheet } from './sheet';
import { loadSettings } from './settings';
import type { AppContext } from './context';
import { PUBLIC_LANDS } from '../map/publicLands';
import { registerLayer } from '../map/layerRegistry';
vi.mock('../usage', () => ({ useFeature: vi.fn(), privacyBlocked: () => false, usageAllowed: () => true, setUsageEnabled: vi.fn() }));
afterEach(() => document.body.replaceChildren());
function setup() {
  const root = document.createElement('section'); document.body.append(root);
  const sheet = new Sheet(root), state = loadSettings(), persist = vi.fn();
  const map = {
    get mapState() { return structuredClone(state); },
    setLayer(id: string, on: boolean) { state.layers[id] = { on, opacity: state.layers[id]?.opacity ?? 1 }; },
    setLayerOpacity(id: string, opacity: number) { state.layers[id]!.opacity = opacity; },
    setCategoryCollapsed(id: string, collapsed: boolean) { state.collapsed[id] = collapsed; },
    setCategoryRemembered(id: string, ids: string[]) { state.remembered[id] = ids; },
  };
  const ctx = { sheet, map, repo: { communitySharing: vi.fn().mockResolvedValue(true), setCommunitySharing: vi.fn().mockResolvedValue(undefined) } } as unknown as AppContext;
  openLayersPanel(ctx, persist, vi.fn()); return { root, sheet, state, persist, ctx };
}
it('updates rows in place, lazily reveals controls, and remembers mixed category choices', () => {
  const { root, state, sheet } = setup();
  const row = root.querySelector('[data-layer="padus-usfs"]')!;
  expect(row.querySelector('input[type=range]')).toBeNull();
  const input = row.querySelector<HTMLInputElement>('input')!; input.checked = true; input.dispatchEvent(new Event('change'));
  expect(state.layers['padus-usfs']!.on).toBe(true);
  expect(root.querySelector('[data-layer="padus-usfs"]')).toBe(row);
  expect(row.querySelector('input[type=range]')).not.toBeNull();
  const master = root.querySelector<HTMLButtonElement>('[aria-label="Toggle Land & Access"]')!;
  expect(master.getAttribute('aria-checked')).toBe('mixed'); master.click();
  expect(state.layers['padus-usfs']!.on).toBe(false); master.click();
  expect(state.layers['padus-usfs']!.on).toBe(true); expect(state.layers['padus-blm']!.on).toBe(false);
  const disclosure = root.querySelector<HTMLButtonElement>('[aria-label="Land & Access layers"]')!;
  disclosure.click(); expect(state.collapsed.land).toBe(false); expect(disclosure.getAttribute('aria-expanded')).toBe('true');
  sheet.close();
});
it('keeps public land information in one dismissible info popover', () => {
  const { root, sheet } = setup();
  const buttons = root.querySelectorAll<HTMLButtonElement>('[aria-label$=" info"]');
  expect(buttons.length).toBe(PUBLIC_LANDS.length); buttons[0]!.click();
  const info = document.querySelector<HTMLElement>('.land-info')!;
  expect(info.hidden).toBe(false); expect(info.textContent).toBe(PUBLIC_LANDS[0].info);
  buttons[1]!.click(); expect(info.textContent).toBe(PUBLIC_LANDS[1].info); expect(buttons[0]!.hasAttribute('aria-describedby')).toBe(false);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); expect(info.hidden).toBe(true);
  buttons[0]!.click(); buttons[0]!.click(); expect(info.hidden).toBe(true);
  sheet.close(); expect(document.querySelector('.land-info')).toBeNull();
});
it('picks up a newly registered category without replacing existing rows', () => {
  const { root, sheet } = setup(); const slope = root.querySelector('[data-layer="slope"]');
  registerLayer({ id: 'test-vegetation', category: 'vegetation', name: 'Test vegetation', defaultOpacity: 1, attribution: '' });
  expect(root.querySelector('[data-layer="test-vegetation"]')).not.toBeNull();
  expect(root.querySelector('[data-layer="slope"]')).toBe(slope);
  const sections = [...root.querySelectorAll('.layer-category')].map(el => el.getAttribute('aria-label'));
  expect(sections.indexOf('Vegetation')).toBeLessThan(sections.indexOf('Water')); sheet.close();
});

it('toggles Public trails through its category, persists and displays its legend', () => {
  const { root, state, persist, sheet } = setup();
  const row = root.querySelector('[data-layer="public-trails"]')!;
  expect(row.textContent).toBe('Public trails');
  const input = row.querySelector<HTMLInputElement>('input')!;
  vi.mocked(useFeature).mockClear();
  input.checked = true; input.dispatchEvent(new Event('change'));
  expect(state.layers['public-trails']!.on).toBe(true); expect(persist).toHaveBeenCalled();
  expect(useFeature).toHaveBeenCalledWith('public_trails');
  expect(row.textContent).toContain('MVUM motor route'); expect(row.querySelector('input[type=range]')).not.toBeNull();
  root.querySelector<HTMLButtonElement>('[aria-label="Toggle Trails"]')!.click();
  expect(state.layers['public-trails']!.on).toBe(false);
  root.querySelector<HTMLButtonElement>('[aria-label="Toggle Trails"]')!.click();
  expect(state.layers['public-trails']!.on).toBe(true);
  sheet.close();
});

it('renders one sharing switch beside preferences and persists changes', async () => {
  const {root,ctx}=setup();
  await vi.waitFor(()=>expect(ctx.repo.communitySharing).toHaveBeenCalled());
  const input=root.querySelector<HTMLInputElement>('[aria-label="Share scan results"]')!;
  expect(input.checked).toBe(true);expect(input.closest('label')!.textContent).toBe('Share scan results');
  input.checked=false;input.dispatchEvent(new Event('change'));
  expect(ctx.repo.setCommunitySharing).toHaveBeenCalledWith(false);
});
