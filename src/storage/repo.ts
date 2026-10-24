import type { IDBPDatabase } from 'idb';
import type { Item } from '../types';
import { HybridClock } from '../sync/hlc';
import { mergeItem } from '../sync/merge';
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
    for (const item of await db.getAll('items')) maxSeen = Math.max(maxSeen, item.updatedAt);
    return new Repo(db, deviceId, new HybridClock(Date.now, maxSeen));
  }

  /** Derived local lab artifacts; excluded from item sync and its outbox. */
  async saveLidarRun(run: Omit<LidarRun, 'id' | 'createdAt'>): Promise<LidarRun> {
    const saved = { ...run, id: uuid(), createdAt: this.clock.now() };
    await this.db.put('lidarRuns', saved);
    return saved;
  }

  listLidarRuns(): Promise<LidarRun[]> { return this.db.getAll('lidarRuns'); }
  async clearLidarRuns(): Promise<void> { await this.db.clear('lidarRuns'); }

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
    for (const incoming of items) {
      this.clock.observe(incoming.updatedAt);
      const local = await itemsStore.get(incoming.id);
      const winner = mergeItem(local, incoming);
      if (winner !== local) {
        changed++;
        await itemsStore.put(winner);
        await outbox.put({ id: winner.id, item: winner, queuedAt: Date.now() });
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
  async ack(entries: Pick<OutboxEntry, 'id' | 'queuedAt'>[]): Promise<void> {
    const tx = this.db.transaction('outbox', 'readwrite');
    for (const e of entries) {
      const cur = await tx.store.get(e.id);
      if (cur && cur.queuedAt === e.queuedAt) await tx.store.delete(e.id);
    }
    await tx.done;
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await this.db.get('meta', key)) as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.db.put('meta', value, key);
  }

  private async writeLocal(item: Item): Promise<void> {
    const tx = this.db.transaction(['items', 'outbox'], 'readwrite');
    await tx.objectStore('items').put(item);
    await tx.objectStore('outbox').put({ id: item.id, item, queuedAt: Date.now() });
    await tx.done;
    this.emitChange();
  }

  private emitChange(): void {
    this.dispatchEvent(new Event('change'));
  }
}
