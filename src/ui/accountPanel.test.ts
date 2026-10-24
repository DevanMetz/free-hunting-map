// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { accountControl } from './accountPanel';
import type { CloudSync } from '../sync/cloud';

const controllers: AbortController[] = [];
function mount(values: Record<string, unknown> = {}) {
  const sync = Object.assign(new EventTarget(), {
    googleClientId: null as string | null, user: null, state: 'signed-out',
    signIn: vi.fn().mockResolvedValue(undefined), signOut: vi.fn().mockResolvedValue(undefined),
    retry: vi.fn().mockResolvedValue(undefined), deleteAccount: vi.fn().mockResolvedValue(undefined), ...values,
  });
  const controller = new AbortController();
  controllers.push(controller);
  const root = accountControl(sync as unknown as CloudSync, controller.signal);
  document.body.append(root);
  return { sync, root };
}
afterEach(() => {
  controllers.splice(0).forEach(controller => controller.abort());
  document.body.replaceChildren();
  delete window.google;
  vi.restoreAllMocks();
});
it('does not load Google when configuration is missing or offline', () => {
  const { root } = mount();
  expect(root.hidden).toBe(true);
  expect(document.querySelector('script[src*="accounts.google.com"]')).toBeNull();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  expect(mount({ googleClientId: 'client-id' }).root.hidden).toBe(true);
  expect(document.querySelector('script[src*="accounts.google.com"]')).toBeNull();
});
it('renders the configured GIS button and forwards its credential', async () => {
  let callback: ((response: { credential: string }) => void) | undefined;
  const renderButton = vi.fn();
  window.google = { accounts: { id: {
    initialize: options => { callback = options.callback; }, renderButton, disableAutoSelect: vi.fn(),
  } } };
  const { sync } = mount({ googleClientId: 'client-id' });
  await Promise.resolve();
  expect(renderButton).toHaveBeenCalledOnce();
  callback!({ credential: 'google-token' });
  expect(sync.signIn).toHaveBeenCalledWith('google-token');
});
it('shows account and accessible sync controls, and releases listeners on close', () => {
  const { sync, root } = mount({ googleClientId: 'client-id', user: { id: 'one', name: 'Devan' }, state: 'error' });
  expect(root.textContent).toContain('Devan');
  const retry = root.querySelector<HTMLButtonElement>('[aria-label="Sync failed — retry"]')!;
  expect(retry.title).toBe('Sync failed — retry');
  retry.click();
  expect(sync.retry).toHaveBeenCalledOnce();
  root.querySelector<HTMLButtonElement>('[aria-label="Sign out"]')!.click();
  expect(sync.signOut).toHaveBeenCalledOnce();
  controllers.at(-1)!.abort();
  sync.user = null;
  sync.dispatchEvent(new Event('change'));
  expect(root.textContent).toContain('Devan');
});

it('requires confirmation before deleting the account', async () => {
  const { sync, root } = mount({googleClientId:'client-id',user:{id:'one'},state:'synced'});
  const confirm = vi.fn().mockReturnValue(false);
  window.confirm = confirm;
  const button = root.querySelector<HTMLButtonElement>('[aria-label="Delete account"]')!;
  expect(button.title).toBe('Delete account');
  button.click(); expect(sync.deleteAccount).not.toHaveBeenCalled();
  confirm.mockReturnValue(true); button.click();
  expect(sync.deleteAccount).toHaveBeenCalledOnce();
  await Promise.resolve();
});

it('renders when configuration arrives after the initial render', async () => {
  const renderButton = vi.fn();
  window.google = { accounts: { id: { initialize: vi.fn(), renderButton, disableAutoSelect: vi.fn() } } };
  const { root, sync } = mount();
  expect(root.hidden).toBe(true);
  sync.googleClientId = 'late-client';
  sync.dispatchEvent(new Event('change'));
  await Promise.resolve();
  expect(root.hidden).toBe(false);
  expect(renderButton).toHaveBeenCalledWith(root.querySelector('.google-sign-in'), expect.objectContaining({ type: 'icon' }));
});
