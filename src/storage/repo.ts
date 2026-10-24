import type { IDBPDatabase } from 'idb';
import type { Item } from '../types';
import { HybridClock } from '../sync/hlc';
import { canonicalJson, mergeItem } from '../sync/merge';
import { sanitizeRecord, portablePreferences, type SyncRecord } from '../sync/records';
import { sanitizeItem } from '../sync/validate';
import { uuid } from '../sync/ids';
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
    return new Repo(db, deviceId, new HybridClock(Date.now, maxSeen));
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
          } else if (!winner.deleted) {
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
    await this.writeLocal(item);
    return item;
  }

  async update<T extends Item>(item: T, patch: Partial<NewItem<T>>): Promise<T> {
    const next = { ...item, ...patch, updatedAt: this.clock.now(), deviceId: this.deviceId };
    await this.writeLocal(next);
    return next;
  }

  async remove(id: string): Promise<void> {
    const item = await this.get(id);
    if (!item || item.deleted) return;
    await this.writeLocal({ ...item, deleted: true, updatedAt: this.clock.now(), deviceId: this.deviceId });
  }

  /** Merge items from another device/file. Safe to repeat. */
  async importItems(items: Item[], source: string): Promise<ImportResult> {
    const tx = this.db.transaction(['items', 'outbox', 'imports'], 'readwrite');
    const itemsStore = tx.objectStore('items');
    const outbox = tx.objectStore('outbox');
    let changed = 0;
    for (const raw of items) {
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

  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await this.db.get('meta', key)) as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    if (key === 'settings') {
      const preferences = portablePreferences(value);
      const previous = await this.db.get('records', 'settings:map');
      if (!previous || previous.kind !== 'settings' || canonicalJson(previous.preferences) !== canonicalJson(preferences)) {
        const now = this.clock.now();
        await this.writeRecord({ kind: 'settings', id: 'settings:map', createdAt: previous?.createdAt ?? now, updatedAt: now, deviceId: this.deviceId, deleted: false, preferences });
      }
    }
    await this.db.put('meta', value, key);
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
