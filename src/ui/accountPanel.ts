import type { CloudSync } from '../sync/cloud';
import { h, iconButton, toast } from './dom';

interface GoogleIdentity {
  initialize(options: { client_id: string; callback: (response: { credential: string }) => void }): void;
  renderButton(parent: HTMLElement, options: { theme: string; size: string; text: string }): void;
  disableAutoSelect(): void;
}

declare global {
  interface Window { google?: { accounts: { id: GoogleIdentity } } }
}

let gisLoading: Promise<GoogleIdentity> | undefined;
function loadGoogle(): Promise<GoogleIdentity> {
  if (window.google?.accounts.id) return Promise.resolve(window.google.accounts.id);
  if (!gisLoading) {
    gisLoading = new Promise<GoogleIdentity>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = () => {
        const identity = window.google?.accounts.id;
        if (identity) resolve(identity);
        else reject(new Error('Google sign-in unavailable'));
      };
      script.onerror = () => { script.remove(); reject(new Error('Google sign-in unavailable')); };
      document.head.append(script);
    }).catch(error => { gisLoading = undefined; throw error; });
  }
  return gisLoading;
}

const labels = {
  'signed-out': 'Sign in with Google', synced: 'Synced', syncing: 'Syncing', offline: 'Offline', error: 'Sync failed — retry',
};

/** The panel owns the abort signal so closing it releases its subscription. */
export function accountControl(sync: CloudSync, signal?: AbortSignal): HTMLElement {
  const root = h('div', { class: 'account-control' });
  let revision = 0;
  const report = (error: unknown) => toast(error instanceof Error ? error.message : 'Sync unavailable');
  const render = () => {
    const current = ++revision;
    root.replaceChildren();
    root.hidden = !sync.googleClientId && !sync.user;
    if (sync.user) {
      const user = sync.user;
      const identity = h('div', { class: 'account-identity' });
      if (user.picture && /^https:\/\/[a-z0-9.-]+\.googleusercontent\.com\//i.test(user.picture)) {
        identity.append(h('img', { src: user.picture, alt: '', class: 'account-avatar', referrerpolicy: 'no-referrer' }));
      }
      identity.append(h('span', { class: 'account-name' }, user.name || user.email || 'Google account'));
      const status = iconButton(sync.state === 'synced' ? 'check' : 'refresh', labels[sync.state], () => {
        void sync.retry().catch(report);
      }, `account-status account-status-${sync.state}`);
      if (sync.state === 'syncing') status.disabled = true;
      const logout = iconButton('close', 'Sign out', () => {
        window.google?.accounts.id.disableAutoSelect();
        void sync.signOut().catch(report);
      });
      const remove = iconButton('trash', 'Delete account', () => {
        if (!window.confirm('Delete your account and all synced server data? Map data on this device will be kept.')) return;
        remove.disabled = true;
        void sync.deleteAccount().then(() => window.google?.accounts.id.disableAutoSelect()).catch(report).finally(() => { remove.disabled = false; });
      });
      root.append(identity, status, logout, remove);
      return;
    }
    if (!sync.googleClientId || !navigator.onLine) { root.hidden = true; return; }
    const button = h('div', { class: 'google-sign-in' });
    root.append(button);
    void loadGoogle().then(identity => {
      if (current !== revision || signal?.aborted) return;
      identity.initialize({ client_id: sync.googleClientId!, callback: response => {
        void sync.signIn(response.credential).catch(report);
      } });
      identity.renderButton(button, { theme: 'outline', size: 'large', text: 'signin_with' });
    }).catch(error => {
      if (current !== revision || signal?.aborted) return;
      button.replaceChildren(iconButton('refresh', 'Retry Google sign-in', render));
      report(error);
    });
  };
  sync.addEventListener('change', render, { signal });
  window.addEventListener('online', render, { signal });
  window.addEventListener('offline', render, { signal });
  signal?.addEventListener('abort', () => { revision++; }, { once: true });
  render();
  return root;
}
