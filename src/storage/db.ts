import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Item } from '../types';

export interface OutboxEntry {
  /** Item id — the outbox keeps only the latest snapshot per item. */
  id: string;
  item: Item;
  queuedAt: number;
}

export interface ImportLogEntry {
  seq?: number;
  at: number;
  source: string;
  received: number;
  changed: number;
}

export interface HuntDB extends DBSchema {
  items: { key: string; value: Item; indexes: { kind: string } };
  outbox: { key: string; value: OutboxEntry };
  imports: { key: number; value: ImportLogEntry };
  /** Small key/value store: deviceId, settings, cached conditions. */
  meta: { key: string; value: unknown };
}

export const DB_NAME = 'open-hunt-map';
export const DB_VERSION = 1;

export function openHuntDB(name = DB_NAME): Promise<IDBPDatabase<HuntDB>> {
  return openDB<HuntDB>(name, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('items', { keyPath: 'id' }).createIndex('kind', 'kind');
        db.createObjectStore('outbox', { keyPath: 'id' });
        db.createObjectStore('imports', { keyPath: 'seq', autoIncrement: true });
        db.createObjectStore('meta');
      }
    },
  });
}
