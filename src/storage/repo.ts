import type { WireScan } from '../community/codec';
import type { IDBPDatabase } from 'idb';
import type { Category, Item } from '../types';
import { HybridClock } from '../sync/hlc';
import { canonicalJson, mergeItem } from '../sync/merge';
import { sanitizeRecord, portablePreferences, type SyncRecord } from '../sync/records';
import { sanitizeItem } from '../sync/validate';
import { legacyTakeoutCategory } from './takeoutMigration';
import { contentId, uuid } from '../sync/ids';
import { openHuntDB, type HuntDB, type OutboxEntry, type LidarRun } from './db';

export interface ImportResult {
  received: number;
  changed: number;
}

type NewItem<T extends Item> = Omit<T, 'id' | 'createdAt' | 'updatedAt' | 'deviceId' | 'deleted'>;

/**
 * Local-first item repository. Every local write stamps HLC time + deviceId and
 * lands in the outbox in the same transaction; imports go through mergeItem.
 * Emits `change` after any write.
 */
export class Repo extends EventTarget {
  private constructor(
    private readonly db: IDBPDatabase<HuntDB>,
    readonly deviceId: string,
    readonly clock: HybridClock,
  ) {
    super();
  }

  static async open(dbName?: string): Promise<Repo> {
    const db = await openHuntDB(dbName);
    let deviceId = (await db.get('meta', 'deviceId')) as string | undefined;
    if (!deviceId) {
      deviceId = uuid();
      await db.put('meta', deviceId, 'deviceId');
    }
    let maxSeen = 0;
    for (const item of [...await db.getAll('items'), ...await db.getAll('records')]) maxSeen = Math.max(maxSeen, item.updatedAt);
    const repo = new Repo(db, deviceId, new HybridClock(Date.now, maxSeen));
    await repo.migrateTakeoutCategories();
    return repo;
  }

  async categories(): Promise<Category[]> {
    return (await this.db.getAll('records')).filter((r): r is Category => r.kind === 'category' && !r.deleted)
      .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  async createCategory(name: string, fields: Partial<Pick<Category, 'color' | 'icon' | 'sort'>> = {}): Promise<Category> {
    const now = this.clock.now();
    const record = sanitizeRecord({ ...fields, kind: 'category', id: uuid(), name, hidden: false,
      createdAt: now, updatedAt: now, deviceId: this.deviceId, deleted: false });
    if (!record || record.kind !== 'category') throw new Error('Category name required');
    await this.writeRecord(record);
    return record;
  }

  async findOrCreateCategory(name: string): Promise<Category> {
    const clean = name.trim().slice(0, 120);
    const existing = (await this.categories()).find(c => c.name.toLowerCase() === clean.toLowerCase());
    if (existing) return existing;
    // Stable IDs keep simultaneous imports of the same list together across devices.
    const id = contentId(JSON.stringify(['category', clean.toLowerCase()]));
    const previous = await this.db.get('records', id);
    const now = this.clock.now();
    const record = sanitizeRecord({ kind: 'category', id, name: clean, hidden: false,
      createdAt: previous?.createdAt ?? now, updatedAt: now, deviceId: this.deviceId, deleted: false });
    if (!record || record.kind !== 'category') throw new Error('Category name required');
    await this.writeRecord(record);
    return record;
  }

  async updateCategory(category: Category, patch: Partial<Pick<Category, 'name' | 'color' | 'icon' | 'hidden' | 'sort'>>): Promise<Category> {
    const current = await this.db.get('records', category.id);
    if (!current || current.kind !== 'category' || current.deleted) throw new Error('Category no longer exists');
    const next = sanitizeRecord({ ...current, ...patch, updatedAt: this.clock.now(), deviceId: this.deviceId });
    if (!next || next.kind !== 'category') throw new Error('Category name required');
    await this.writeRecord(next);
    return next;
  }

  async removeCategory(id: string, deleteItems = false): Promise<void> {
    const category = await this.db.get('records', id);
    if (!category || category.kind !== 'category' || category.deleted) return;
    if (deleteItems) for (const item of await this.list()) if (item.categoryId === id) await this.remove(item.id);
    await this.writeRecord({ ...category, deleted: true, updatedAt: this.clock.now(), deviceId: this.deviceId });
  }

  async migrateTakeoutCategories(): Promise<void> {
    if (await this.getMeta('migration:takeout-categories:v1')) return;
    const names = (await this.db.getAll('imports')).map(log => /(?:^|[/:])([^/]+)\.csv$/i.exec(log.source)?.[1]).filter((n): n is string => !!n);
    for (const item of await this.list()) {
      const legacy = legacyTakeoutCategory(item, names);
      if (!legacy) continue;
      const category = await this.findOrCreateCategory(legacy.name);
      await this.update(item, { categoryId: category.id, note: legacy.note });
    }
    await this.setMeta('migration:takeout-categories:v1', true);
  }

  async saveLidarRun(run: Omit<LidarRun, 'id' | 'createdAt'>): Promise<LidarRun> {
    const now = this.clock.now();
    const record = sanitizeRecord({ ...run, kind: 'lidar-run', id: uuid(), createdAt: now, updatedAt: now, deviceId: this.deviceId, deleted: false });
    if (!record || record.kind !== 'lidar-run') throw new Error('Invalid trail candidates');
    await this.writeRecord(record);
    return record;
  }

  listLidarRuns(): Promise<LidarRun[]> { return this.db.getAll('lidarRuns'); }
  async clearLidarRuns(): Promise<void> {
    for (const run of await this.db.getAll('lidarRuns')) {
      if (!await this.db.get('records', run.id)) await this.writeRecord({ ...run, kind: 'lidar-run', updatedAt: run.createdAt, deviceId: this.deviceId, deleted: false });
    }
    for (const record of await this.db.getAll('records')) {
      if (record.kind === 'lidar-run' && !record.deleted) await this.writeRecord({ ...record, deleted: true, updatedAt: this.clock.now(), deviceId: this.deviceId });
    }
  }

  async allSyncRecords(): Promise<SyncRecord[]> {
    return [...await this.db.getAll('items'), ...await this.db.getAll('records')];
  }

  async bindSyncAccount(userId: string): Promise<void> {
    const tx = this.db.transaction('meta', 'readwrite');
    const owner = await tx.store.get('cloud.owner');
    if (owner && owner !== userId) {
      await tx.done;
      throw new Error('This browser’s data belongs to another account. Use a separate browser profile.');
    }
    if (!owner) await tx.store.put(userId, 'cloud.owner');
    await tx.done;
    if (!owner) await this.enqueueAllForSync();
  }

  importRecords(records: unknown[], _source?: string): Promise<void> { return this.importSyncRecords(records); }

  async enqueueAllForSync(): Promise<void> {
    // Upgrade pre-sync installations without changing their saved candidate IDs.
    for (const run of await this.db.getAll('lidarRuns')) {
      if (!await this.db.get('records', run.id)) await this.writeRecord({ ...run, kind: 'lidar-run', updatedAt: run.createdAt, deviceId: this.deviceId, deleted: false });
    }
    const settings = await this.getMeta('settings');
    if (settings && !await this.db.get('records', 'settings:map')) await this.setMeta('settings', settings);
    for (const record of await this.allSyncRecords()) await this.db.put('outbox', this.entry(record));
  }

  /** Remote snapshots never echo into the outbox. */
  async importSyncRecords(records: unknown[]): Promise<void> {
    let preferencesChanged = false;
    let changed = false;
    for (const raw of records) {
      const incoming = sanitizeRecord(raw);
      if (!incoming) throw new Error('Invalid sync record');
      this.clock.observe(incoming.updatedAt);
      const store = incoming.kind === 'waypoint' || incoming.kind === 'track' ? 'items' : 'records';
      const tx = this.db.transaction([store, 'meta', 'lidarRuns'], 'readwrite');
      const local = await tx.objectStore(store).get(incoming.id);
      const winner = mergeItem<SyncRecord>(local, incoming);
      if (winner !== local) {
        changed = true;
        if (winner.kind === 'waypoint' || winner.kind === 'track') await tx.objectStore('items').put(winner);
        else {
          await tx.objectStore('records').put(winner);
          if (winner.kind === 'lidar-run') {
            if (winner.deleted) await tx.objectStore('lidarRuns').delete(winner.id);
            else await tx.objectStore('lidarRuns').put(winner);
          } else if (winner.kind === 'settings' && !winner.deleted) {
            const settings = await tx.objectStore('meta').get('settings') as Record<string, unknown> | undefined;
            await tx.objectStore('meta').put({ ...settings, ...winner.preferences }, 'settings');
            preferencesChanged = true;
          }
        }
      }
      await tx.done;
    }
    if (changed) this.emitChange();
    if (preferencesChanged) this.dispatchEvent(new Event('preferences'));
  }

  /** Live (non-deleted) items. */
  async list(): Promise<Item[]> {
    return (await this.db.getAll('items')).filter((i) => !i.deleted);
  }

  /** Every item including tombstones — what a sync peer needs. */
  allIncludingDeleted(): Promise<Item[]> {
    return this.db.getAll('items');
  }

  get(id: string): Promise<Item | undefined> {
    return this.db.get('items', id);
  }

  async create<T extends Item>(fields: NewItem<T>): Promise<T> {
    const now = this.clock.now();
    const item = {
      ...fields,
      id: uuid(),
      createdAt: now,
      updatedAt: now,
      deviceId: this.deviceId,
      deleted: false,
    } as unknown as T;
    const clean = sanitizeItem(item);
    if (!clean) throw new Error('Invalid item');
    await this.writeLocal(clean);
    return clean as T;
  }

  async update<T extends Item>(item: T, patch: Partial<NewItem<T>>): Promise<T> {
    const tx = this.db.transaction(['items', 'outbox'], 'readwrite');
    const current = await tx.objectStore('items').get(item.id);
    if (!current || current.deleted) { await tx.done; throw new Error('Item no longer exists'); }
    const next = sanitizeItem({ ...current, ...patch, updatedAt: this.clock.now(), deviceId: this.deviceId });
    if (!next) { await tx.done; throw new Error('Invalid item'); }
    await tx.objectStore('items').put(next);
    await tx.objectStore('outbox').put(this.entry(next));
    await tx.done;
    this.emitChange();
    return next as T;
  }

  async remove(id: string): Promise<void> {
    const item = await this.get(id);
    if (!item || item.deleted) return;
    await this.writeLocal({ ...item, deleted: true, updatedAt: this.clock.now(), deviceId: this.deviceId });
  }

  /** Merge items from another device/file. Safe to repeat. */
  async importItems(items: Item[], source: string): Promise<ImportResult> {
    const resolved: Item[] = [];
    for (const raw of items) {
      const item = sanitizeItem(raw);
      if (!item) continue;
      if (item.categoryName) {
        const category = await this.findOrCreateCategory(item.categoryName);
        const { categoryName: _name, ...rest } = item;
        resolved.push({ ...rest, categoryId: category.id } as Item);
      } else resolved.push(item);
    }
    const tx = this.db.transaction(['items', 'outbox', 'imports'], 'readwrite');
    const itemsStore = tx.objectStore('items');
    const outbox = tx.objectStore('outbox');
    let changed = 0;
    for (const raw of resolved) {
      const incoming = sanitizeItem(raw);
      if (!incoming) continue;
      this.clock.observe(incoming.updatedAt);
      const local = await itemsStore.get(incoming.id);
      const winner = mergeItem(local, incoming);
      if (winner !== local) {
        changed++;
        await itemsStore.put(winner);
        await outbox.put(this.entry(winner));
      }
    }
    await tx.objectStore('imports').add({ at: Date.now(), source, received: items.length, changed });
    await tx.done;
    if (changed) this.emitChange();
    return { received: items.length, changed };
  }

  /** Pending changes for a future sync server to drain. */
  pending(): Promise<OutboxEntry[]> {
    return this.db.getAll('outbox');
  }

  /** Drop outbox entries once a server has acknowledged them (only if unchanged since). */
  async ack(entries: OutboxEntry[]): Promise<void> {
    const tx = this.db.transaction('outbox', 'readwrite');
    for (const e of entries) {
      const cur = await tx.store.get(e.id);
      if (cur && cur.revision === e.revision && canonicalJson(cur.item) === canonicalJson(e.item)) await tx.store.delete(e.id);
    }
    await tx.done;
  }

  /** Account deletion releases ownership while keeping all local map data. */
  async resetSyncAccount(): Promise<void> {
    const tx = this.db.transaction('meta', 'readwrite');
    for (const key of ['cloud.owner', 'cloud.cursor', 'cloud.logout']) await tx.store.delete(key);
    await tx.done;
  }

  /** Anonymous vote credential is device-local and never enters sync records. */
  async communityVoteToken(): Promise<string> {
    const tx = this.db.transaction('meta', 'readwrite');
    let token = await tx.store.get('community.voteToken') as string | undefined;
    if (!token) {
      token = Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
      await tx.store.put(token, 'community.voteToken');
    }
    await tx.done;
    return token;
  }
  async communitySharing(): Promise<boolean> { return await this.getMeta('community.share') !== false; }

  async setCommunitySharing(on: boolean): Promise<void> {
    const tx = this.db.transaction(['meta', 'communityQueue'], 'readwrite');
    await tx.objectStore('meta').put(on, 'community.share');
    if (!on) await tx.objectStore('communityQueue').clear();
    await tx.done;
    this.dispatchEvent(new Event('community'));
  }

  /** The completion-time decision and queue insert are atomic and independent of accounts. */
  async queueCommunity(scan: WireScan): Promise<void> {
    const tx = this.db.transaction(['meta', 'communityQueue'], 'readwrite');
    if (await tx.objectStore('meta').get('community.share') !== false) {
      await tx.objectStore('communityQueue').put({ id: uuid(), sharing: true, scan });
    }
    await tx.done;
    this.dispatchEvent(new Event('community'));
  }
  async pendingCommunity() { return this.db.getAll('communityQueue'); }
  async ackCommunity(id: string) { await this.db.delete('communityQueue', id); }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await this.db.get('meta', key)) as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    if (key !== 'settings') { await this.db.put('meta', value, key); return; }
    // The visible settings and their sync snapshot must commit together, including on reload.
    const tx = this.db.transaction(['records', 'outbox', 'meta'], 'readwrite');
    const preferences = portablePreferences(value);
    const previous = await tx.objectStore('records').get('settings:map');
    const changed = !previous || previous.kind !== 'settings' || canonicalJson(previous.preferences) !== canonicalJson(preferences);
    if (changed) {
      const now = this.clock.now();
      const record: SyncRecord = { kind: 'settings', id: 'settings:map', createdAt: previous?.createdAt ?? now, updatedAt: now, deviceId: this.deviceId, deleted: false, preferences };
      await tx.objectStore('records').put(record);
      await tx.objectStore('outbox').put(this.entry(record));
    }
    await tx.objectStore('meta').put(value, key);
    await tx.done;
    if (changed) this.emitChange();
  }

  private entry(item: SyncRecord): OutboxEntry {
    return { id: item.id, item, queuedAt: Date.now(), revision: uuid() };
  }

  private async writeRecord(record: SyncRecord): Promise<void> {
    const tx = this.db.transaction(['records', 'outbox', 'lidarRuns'], 'readwrite');
    await tx.objectStore('records').put(record);
    await tx.objectStore('outbox').put(this.entry(record));
    if (record.kind === 'lidar-run') {
      if (record.deleted) await tx.objectStore('lidarRuns').delete(record.id);
      else await tx.objectStore('lidarRuns').put(record);
    }
    await tx.done;
    this.emitChange();
  }

  private async writeLocal(item: Item): Promise<void> {
    const tx = this.db.transaction(['items', 'outbox'], 'readwrite');
    await tx.objectStore('items').put(item);
    await tx.objectStore('outbox').put(this.entry(item));
    await tx.done;
    this.emitChange();
  }

  private emitChange(): void {
    this.dispatchEvent(new Event('change'));
  }
}
