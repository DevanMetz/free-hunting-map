import type { CloudSync } from '../sync/cloud';
import { h, iconButton, toast } from './dom';

interface GoogleIdentity {
  initialize(options: { client_id: string; callback: (response: { credential: string }) => void }): void;
  renderButton(parent: HTMLElement, options: { type: string; theme: string; size: string; text: string }): void;
  disableAutoSelect(): void;
}

declare global {
  interface Window { google?: { accounts: { id: GoogleIdentity } } }
}

let gisLoading: Promise<GoogleIdentity> | undefined;
export function loadGoogle(): Promise<GoogleIdentity> {
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

/** A single persistent account entry point, independent of panel lifetimes. */
export function accountControl(sync: CloudSync, signal?: AbortSignal): HTMLElement {
  const root = h('div', { class: 'account-control' });
  let revision = 0;
  let signedOutClient: string | null = null;
  // Chromium exposes the active iframe on document, but does not propagate
  // :focus-within from its inner button. Mirror that boundary without moving focus.
  const reflectFrameFocus = () => {
    root.classList.toggle('account-frame-focus', !!root.querySelector('.google-sign-in')?.contains(document.activeElement));
  };
  window.addEventListener('blur', reflectFrameFocus, { signal });
  window.addEventListener('focus', reflectFrameFocus, { signal });
  document.addEventListener('focusin', reflectFrameFocus, { signal });
  const dismiss = () => {
    const menu = root.querySelector<HTMLElement>('.account-menu');
    if (menu) menu.hidden = true;
    root.querySelector('.account-toggle')?.setAttribute('aria-expanded', 'false');
  };
  document.addEventListener('pointerdown', event => { if (!root.contains(event.target as Node)) dismiss(); }, { signal });
  root.addEventListener('focusout', event => { if (!root.contains(event.relatedTarget as Node | null)) dismiss(); });
  const report = (error: unknown) => toast(error instanceof Error ? error.message : 'Sync unavailable');
  const render = () => {
    const client = !sync.user && navigator.onLine ? sync.googleClientId : null;
    // Session/config notifications must not replace a live sign-in iframe mid-click.
    if (client && client === signedOutClient && root.firstChild) return;
    signedOutClient = client;
    const current = ++revision;
    root.classList.remove('account-frame-focus');
    root.replaceChildren();
    root.hidden = !sync.googleClientId;
    if (root.hidden) return;
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
      const menu = h('div', { class: 'account-menu', hidden: true });
      const avatar = iconButton('layers', `Account: ${user.name || user.email || 'Google account'} — ${labels[sync.state]}`, () => {
        menu.hidden = !menu.hidden;
        avatar.setAttribute('aria-expanded', String(!menu.hidden));
      }, `account-toggle account-status-${sync.state}`);
      avatar.setAttribute('aria-expanded', 'false');
      const picture = identity.querySelector('img');
      avatar.replaceChildren(picture ? picture.cloneNode(true) : h('span', {}, (user.name || user.email || 'G').slice(0, 1).toUpperCase()),
        h('span', { class: 'account-dot', 'aria-hidden': 'true' }));
      menu.append(identity, h('div', { class: 'account-actions' }, status, logout, remove), h('nav', { class: 'policy-links', 'aria-label': 'Policies' },
        h('a', { href: '/privacy' }, 'Privacy'), h('a', { href: '/terms' }, 'Terms')));
      root.onkeydown = event => { if (event.key === 'Escape') { dismiss(); avatar.focus(); } };
      root.append(avatar, menu);
      return;
    }
    if (!sync.googleClientId || !navigator.onLine) { root.hidden = true; return; }
    const button = h('div', { class: 'google-sign-in' });
    const visual = iconButton('google', 'Sign in with Google', () => {}, 'account-sign-in');
    // The GIS iframe is the only interactive/focusable target. Never synthesize its click.
    visual.tabIndex = -1;
    visual.setAttribute('aria-hidden', 'true');
    const control = h('div', { class: 'account-sign-in-control', title: 'Sign in with Google' }, visual, button);
    root.append(control);
    void loadGoogle().then(identity => {
      if (current !== revision || signal?.aborted) return;
      identity.initialize({ client_id: sync.googleClientId!, callback: response => {
        void sync.signIn(response.credential).catch(report);
      } });
      identity.renderButton(button, { type: 'icon', theme: 'outline', size: 'large', text: 'signin_with' });
    }).catch(error => {
      if (current !== revision || signal?.aborted) return;
      control.replaceChildren(iconButton('refresh', 'Retry Google sign-in', () => { signedOutClient = null; render(); }));
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
