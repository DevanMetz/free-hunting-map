import { Capacitor } from '@capacitor/core';
import type { CloudSync } from '../sync/cloud';
import { nativeGoogleCredential, usesNativeAccount } from '../sync/nativeAccount';
import { createKey, listKeys, revokeKey, type ApiKeyInfo } from '../sync/apiKeys';
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
  let menuOpen = false;
  let keysOpen = false;
  let keyRows: ApiKeyInfo[] = [];
  let revealed: { id: string; key: string } | null = null;
  let draftName = '';
  let keysGeneration = 0;
  // Chromium exposes the active iframe on document, but does not propagate
  // :focus-within from its inner button. Mirror that boundary without moving focus.
  const reflectFrameFocus = () => {
    root.classList.toggle('account-frame-focus', !!root.querySelector('.google-sign-in')?.contains(document.activeElement));
  };
  window.addEventListener('blur', reflectFrameFocus, { signal });
  window.addEventListener('focus', reflectFrameFocus, { signal });
  document.addEventListener('focusin', reflectFrameFocus, { signal });
  const dismiss = () => {
    menuOpen = false;
    keysOpen = false;
    revealed = null;
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
      const menu = h('div', { class: 'account-menu', hidden: !menuOpen });
      const avatar = iconButton('layers', `Account: ${user.name || user.email || 'Google account'} — ${labels[sync.state]}`, () => {
        menuOpen = !menuOpen;
        menu.hidden = !menuOpen;
        avatar.setAttribute('aria-expanded', String(menuOpen));
      }, `account-toggle account-status-${sync.state}`);
      avatar.setAttribute('aria-expanded', String(menuOpen));
      const picture = identity.querySelector('img');
      avatar.replaceChildren(picture ? picture.cloneNode(true) : h('span', {}, (user.name || user.email || 'G').slice(0, 1).toUpperCase()),
        h('span', { class: 'account-dot', 'aria-hidden': 'true' }));
      const refreshKeys = () => {
        const generation = ++keysGeneration;
        void listKeys().then(rows => {
          if (generation !== keysGeneration) return;
          keyRows = rows;
          render();
        }).catch(error => { if (generation === keysGeneration) report(error); });
      };
      const keysButton = Capacitor.isNativePlatform() ? null : iconButton('key', 'API keys', () => {
        keysOpen = !keysOpen;
        render();
        if (keysOpen) refreshKeys();
      });
      const actions = h('div', { class: 'account-actions' }, status, keysButton, logout, remove);
      const keysBlock = h('div', { class: 'account-keys' });
      if (revealed) {
        const secret = revealed.key;
        keysBlock.append(h('div', { class: 'account-key-secret' },
          h('input', { class: 'field', readonly: true, value: secret, 'aria-label': 'API key' }),
          iconButton('copy', 'Copy key', () => { void navigator.clipboard.writeText(secret).catch(() => report(new Error('Copy failed'))); })));
      }
      for (const key of keyRows) {
        keysBlock.append(h('div', { class: 'account-key-row' },
          h('div', { class: 'account-key-meta' }, h('span', { class: 'account-key-name' }, key.name), h('span', { class: 'account-key-prefix' }, key.prefix)),
          iconButton('trash', 'Revoke key', () => {
            void revokeKey(key.id).then(() => {
              keyRows = keyRows.filter(item => item.id !== key.id);
              if (revealed?.id === key.id) revealed = null;
              render();
            }).catch(report);
          })));
      }
      const nameInput = h('input', {
        class: 'field', placeholder: 'Key name', 'aria-label': 'Key name', value: draftName,
        oninput: event => { draftName = (event.target as HTMLInputElement).value; },
        onkeydown: event => { if ((event as KeyboardEvent).key === 'Enter') { event.preventDefault(); void create(); } },
      });
      const create = async () => {
        try {
          const created = await createKey(draftName.trim());
          revealed = { id: created.id, key: created.key };
          draftName = '';
          keyRows = [...keyRows.filter(item => item.id !== created.id), { id: created.id, name: created.name, prefix: created.prefix, created_at: Date.now(), last_used_at: null }];
        } catch (error) { report(error); }
        render();
      };
      keysBlock.append(h('div', { class: 'account-key-create' }, nameInput, iconButton('plus', 'Create key', () => { void create(); })));
      const policies = h('nav', { class: 'policy-links', 'aria-label': 'Policies' }, h('a', { href: '/privacy' }, 'Privacy'), h('a', { href: '/terms' }, 'Terms'), usesNativeAccount() ? null : h('a', { href: '/download/free-hunting-map.apk' }, 'Android'));
      menu.append(identity, actions);
      if (keysOpen) menu.append(keysBlock);
      menu.append(policies);
      root.onkeydown = event => { if (event.key === 'Escape') { event.stopPropagation(); dismiss(); avatar.focus(); } };
      root.append(avatar, menu);
      return;
    }
    menuOpen = false; keysOpen = false; revealed = null;
    if (!sync.googleClientId || !navigator.onLine) { root.hidden = true; return; }
    if (usesNativeAccount()) {
      const visual = iconButton('google', 'Sign in with Google', () => {
        visual.disabled = true;
        void nativeGoogleCredential(sync.googleClientId!).then(credential => sync.signIn(credential)).catch(report).finally(() => { visual.disabled = false; });
      }, 'account-sign-in');
      root.append(visual);
      return;
    }
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
