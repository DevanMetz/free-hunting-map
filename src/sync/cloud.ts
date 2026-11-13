import { Capacitor } from '@capacitor/core';
import { serviceUrl } from '../serviceUrl';
import { useFeature } from '../usage';
import type { Repo } from '../storage/repo';
import { sanitizeRecord } from './records';

export interface CloudUser { id: string; name?: string; email?: string; picture?: string }
export type SyncState = 'signed-out' | 'synced' | 'syncing' | 'offline' | 'error';
type Fetcher = typeof fetch;
class TransportError extends Error {}

const SESSION_KEY = 'cloud.session';

/** Website calls use the session cookie. The Android app stores the same session and sends it as a bearer token. */
export class CloudSync extends EventTarget {
  googleClientId: string | null = null;
  user: CloudUser | null = null;
  state: SyncState = 'signed-out';
  private running: Promise<void> | undefined;
  private epoch = 0;
  private deleting = false;
  private sessionChecked = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private wakeTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly wake = () => {
    clearTimeout(this.wakeTimer);
    this.wakeTimer = setTimeout(() => { void this.retry(); }, 500);
  };
  // Native fetch rejects CloudSync as its receiver in browsers; call it through a wrapper.
  constructor(private readonly repo: Repo, private readonly request: Fetcher = (input, init) => fetch(input, init),
    private readonly online: () => boolean = () => navigator.onLine) { super(); }

  async start(): Promise<void> {
    this.googleClientId = await this.repo.getMeta<string>('cloud.clientId') ?? null;
    this.emit();
    await this.retry();
    this.repo.addEventListener('change', this.wake);
    globalThis.addEventListener?.('online', this.wake);
    globalThis.addEventListener?.('offline', this.wake);
    globalThis.document?.addEventListener('visibilitychange', this.wake);
    this.timer = setInterval(this.wake, 60_000);
  }
  stop(): void {
    this.epoch++;
    clearInterval(this.timer);
    clearTimeout(this.wakeTimer);
    this.repo.removeEventListener('change', this.wake);
    globalThis.removeEventListener?.('online', this.wake);
    globalThis.removeEventListener?.('offline', this.wake);
    globalThis.document?.removeEventListener('visibilitychange', this.wake);
  }
  private emit(): void { this.dispatchEvent(new Event('change')); }
  private async sessionToken(): Promise<string | null> {
    if (!Capacitor.isNativePlatform()) return null;
    const token = await this.repo.getMeta<string>(SESSION_KEY);
    return typeof token === 'string' && /^[0-9a-f]{64}$/i.test(token) ? token : null;
  }
  private async json(path: string, body?: unknown): Promise<any> {
    const token = await this.sessionToken();
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await this.request(serviceUrl(`/api/${path}`), {
      credentials: Capacitor.isNativePlatform() ? 'omit' : 'same-origin', cache: 'no-store',
      ...(Object.keys(headers).length ? { headers } : {}),
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
    }).catch(() => { throw new TransportError('Cloud sync transport unavailable'); });
    if (!res.ok) {
      if (res.status === 401) {
        this.sessionChecked = true; this.user = null; this.state = 'signed-out';
        if (token) await this.repo.setMeta(SESSION_KEY, null);
        this.emit();
      }
      throw new Error(`Cloud sync: ${res.status}`);
    }
    return res.json().catch(error => {
      if (error instanceof TypeError || (error instanceof Error && error.name === 'AbortError')) throw new TransportError('Cloud sync response interrupted');
      throw error;
    });
  }
  async signIn(credential: string): Promise<void> {
    if (this.deleting) throw new Error('Account deletion in progress');
    if (await this.repo.getMeta<boolean>('cloud.logout')) await this.finishLogout();
    const result = await this.json('auth/google', { credential }).catch(error=>{useFeature('sign_in','fail'); throw error;});
    useFeature('sign_in','ok');
    if (typeof result.token === 'string' && /^[0-9a-f]{64}$/i.test(result.token)) await this.repo.setMeta(SESSION_KEY, result.token.toLowerCase());
    try { await this.repo.bindSyncAccount(result.user.id); }
    catch (err) {
      await this.json('auth/logout', {});
      await this.repo.setMeta(SESSION_KEY, null);
      throw err;
    }
    this.epoch++;
    this.user = result.user;
    this.emit();
    await this.running;
    await this.retry();
  }
  async signOut(): Promise<void> {
    this.epoch++;
    this.sessionChecked = true;
    this.user = null;
    this.state = 'signed-out';
    await this.repo.setMeta('cloud.logout', true);
    this.emit();
    if (this.online()) { try { await this.finishLogout(); } catch { /* Persist until reconnect. */ } }
  }
  async deleteAccount(): Promise<void> {
    if (this.deleting) return;
    if (!this.online()) throw new Error('Connect to delete your account');
    this.deleting = true;
    this.epoch++;
    clearTimeout(this.wakeTimer);
    try {
      // Finish any old response before resetting its persisted cursor/binding.
      await this.running;
      await this.json('account/delete', {});
      this.user = null;
      this.state = 'signed-out';
      await this.repo.setMeta(SESSION_KEY, null);
      await this.repo.resetSyncAccount();
    } catch (error) {
      if (this.user) this.state = 'error';
      throw error;
    } finally {
      this.deleting = false;
      this.emit();
    }
  }

  private async finishLogout(): Promise<void> {
    await this.json('auth/logout', {});
    await this.repo.setMeta('cloud.logout', false);
    await this.repo.setMeta(SESSION_KEY, null);
  }
  retry(): Promise<void> {
    if (this.deleting) return Promise.resolve();
    if (this.running) return this.running;
    this.running = this.run().finally(() => { this.running = undefined; });
    return this.running;
  }
  private async run(): Promise<void> {
    const epoch = this.epoch;
    let syncing = false;
    if (!this.online()) { this.state = this.user ? 'offline' : 'signed-out'; this.emit(); return; }
    try {
      if (await this.repo.getMeta<boolean>('cloud.logout')) { await this.finishLogout(); return; }
      if (this.sessionChecked && !this.user) return;
      const config = await this.json('config');
      if (epoch !== this.epoch) return;
      this.googleClientId = typeof config.googleClientId === 'string' ? config.googleClientId : null;
      await this.repo.setMeta('cloud.clientId', this.googleClientId);
      this.emit();
      const me = await this.json('me');
      if (epoch !== this.epoch) return;
      this.sessionChecked = true;
      this.user = me.user;
      if (!this.user) { this.state = 'signed-out'; this.emit(); return; }
      await this.repo.bindSyncAccount(this.user.id);
      if (epoch !== this.epoch || !this.user) return;
      syncing = true;
      this.state = 'syncing'; this.emit();
      let cursor = await this.repo.getMeta<number>('cloud.cursor') ?? 0;
      for (;;) {
        if (epoch !== this.epoch) return;
        const pending = await this.repo.pending();
        const batch = [] as typeof pending;
        let bytes = 0;
        for (const entry of pending) {
          const size = new TextEncoder().encode(JSON.stringify(entry.item)).length;
          if (size > 1_000_000) throw new Error('Cloud record exceeds 1 MB');
          if (batch.length >= 50 || bytes + size > 6_000_000) break;
          batch.push(entry); bytes += size;
        }
        if (epoch !== this.epoch || !this.user) return;
        const result = await this.json('sync', { cursor, changes: batch.map(e => e.item) });
        if (epoch !== this.epoch) return;
        if (!Number.isSafeInteger(result.cursor) || result.cursor < cursor || !Array.isArray(result.changes)) throw new Error('Invalid sync response');
        const changes = result.changes.map((r: unknown) => sanitizeRecord(r));
        if (changes.some((r: unknown) => r === null)) throw new Error('Invalid cloud record');
        await this.repo.importRecords(changes);
        await this.repo.ack(batch);
        cursor = result.cursor;
        await this.repo.setMeta('cloud.cursor', cursor);
        if (!result.hasMore && !(await this.repo.pending()).length) break;
      }
      this.state = 'synced'; useFeature('sync','ok');
    } catch (error) {
      if (epoch !== this.epoch) return;
      if (syncing && this.user && this.online() && !(error instanceof TransportError) && !(error instanceof Error && error.name === 'AbortError')) useFeature('sync','fail');
      this.state = this.user ? (this.online() ? 'error' : 'offline') : 'signed-out';
    }
    this.emit();
  }
}
