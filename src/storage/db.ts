import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Candidates } from '../lidar/postprocess';
import type { Box } from '../lidar/ept';
import type { Item } from '../types';

import type { SyncRecord } from '../sync/records';

export interface OutboxEntry {
  /** Item id — the outbox keeps only the latest snapshot per item. */
  id: string;
  item: SyncRecord;
  queuedAt: number;
  revision?: string;
}

export interface ImportLogEntry {
  seq?: number;
  at: number;
  source: string;
  received: number;
  changed: number;
}

export interface LidarRun { id: string; createdAt: number; box: Box; candidates: Candidates }

export interface HuntDB extends DBSchema {
  records: { key: string; value: SyncRecord };
  lidarRuns: { key: string; value: LidarRun };
  items: { key: string; value: Item; indexes: { kind: string } };
  outbox: { key: string; value: OutboxEntry };
  imports: { key: number; value: ImportLogEntry };
  /** Small key/value store: deviceId, settings, cached conditions. */
  meta: { key: string; value: unknown };
}

// Stable across rebrands so existing data remains accessible on this origin.
export const DB_NAME = 'open-hunt-map';
export const DB_VERSION = 4;

export function openHuntDB(name = DB_NAME): Promise<IDBPDatabase<HuntDB>> {
  let database: IDBPDatabase<HuntDB> | undefined;
  return openDB<HuntDB>(name, DB_VERSION, {
    blocking() { database?.close(); },
    upgrade(db, oldVersion) {
      // v4 categories reuse the generic records store; all v3 stores remain intact.
      if (oldVersion < 3) db.createObjectStore('records', { keyPath: 'id' });
      if (oldVersion < 2) db.createObjectStore('lidarRuns', { keyPath: 'id' });
      if (oldVersion < 1) {
        db.createObjectStore('items', { keyPath: 'id' }).createIndex('kind', 'kind');
        db.createObjectStore('outbox', { keyPath: 'id' });
        db.createObjectStore('imports', { keyPath: 'seq', autoIncrement: true });
        db.createObjectStore('meta');
      }
    },
  }).then(db => { database = db; return db; });
}
