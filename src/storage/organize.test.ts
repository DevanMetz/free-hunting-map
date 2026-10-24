import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { describe, expect, it } from 'vitest';
import { Repo } from './repo';
import { openHuntDB, DB_VERSION } from './db';
import { wp, trk } from '../test/fixtures';
import { contentId } from '../sync/ids';
import { categoryOf, isVisible } from '../organize/model';
import { legacyTakeoutCategory } from './takeoutMigration';
const fresh = () => Repo.open(crypto.randomUUID());

describe('organize storage', () => {
  it('upgrades a populated v3 DB without losing any store or queued write', async () => {
    const name = crypto.randomUUID();
    const old = await openDB(name, 3, { upgrade(db) {
      db.createObjectStore('items', { keyPath: 'id' }).createIndex('kind', 'kind');
      for (const store of ['outbox', 'records', 'lidarRuns']) db.createObjectStore(store, { keyPath: 'id' });
      db.createObjectStore('imports', { keyPath: 'seq', autoIncrement: true }); db.createObjectStore('meta');
    } });
    const tombstone = { ...trk(), deleted: true };
    const queue = { id: wp().id, item: wp(), queuedAt: 2, revision: 'keep' };
    const run = { id: 'lidar-12345', createdAt: 1, box: [-90, 40, -89, 41], candidates: { type: 'FeatureCollection', features: [] } };
    const record = { kind: 'settings', id: 'settings:map', createdAt: 1, updatedAt: 2, deviceId: 'old', deleted: false, preferences: { labels: false } };
    await old.put('items', wp()); await old.put('items', tombstone); await old.put('outbox', queue);
    await old.put('records', record); await old.put('lidarRuns', run); await old.put('meta', { zoom: 7 }, 'custom');
    await old.add('imports', { source: 'old.gpx', at: 1, received: 2, changed: 2 }); old.close();
    const db = await openHuntDB(name);
    expect(db.version).toBe(DB_VERSION);
    expect(await db.getAll('items')).toEqual(expect.arrayContaining([wp(), tombstone]));
    expect(await db.get('outbox', queue.id)).toEqual(queue);
    expect(await db.get('records', record.id)).toEqual(record);
    expect(await db.get('lidarRuns', run.id)).toEqual(run);
    expect(await db.get('meta', 'custom')).toEqual({ zoom: 7 });
    expect(await db.getAll('imports')).toHaveLength(1); db.close();
  });
  it('migrates Takeout lists once through stamped Repo writes, retaining other fields', async () => {
    const name = crypto.randomUUID(), db = await openHuntDB(name);
    const sourceUrl = 'https://www.google.com/maps/place/test/data=!3d40!4d-90';
    const item = { ...wp(), id: contentId(JSON.stringify(['takeout', sourceUrl])), sourceUrl, note: 'First line\nAddress\nWant to go' };
    await db.put('items', item); await db.put('items', trk()); db.close();
    const repo = await Repo.open(name), migrated = (await repo.get(item.id))!;
    const category = (await repo.categories())[0]!;
    expect(category.name).toBe('Want to go');
    expect(migrated).toEqual({ ...item, note: 'First line\nAddress', categoryId: category.id, updatedAt: migrated.updatedAt, deviceId: repo.deviceId });
    expect(migrated.updatedAt).toBeGreaterThan(item.updatedAt);
    expect(await repo.pending()).toHaveLength(2);
    await repo.migrateTakeoutCategories();
    const reopened = await Repo.open(name);
    expect(await reopened.get(item.id)).toEqual(migrated);
    expect(await reopened.categories()).toHaveLength(1);
    expect(await reopened.get(trk().id)).toEqual(trk());
    expect(legacyTakeoutCategory({ ...item, id: 'ordinary-pin', note: 'Important note' })).toBeNull();
    expect(legacyTakeoutCategory({ ...item, sourceUrl: 'https://example.com', note: 'Saved places' })).toBeNull();
  });
  it('syncs category edits, visibility and tombstones with newest-wins and fallback', async () => {
    const a = await fresh(), b = await fresh();
    const category = await a.createCategory('North', { color: '#aabbcc', icon: 'stand' });
    await a.importItems([{ ...wp(), categoryId: category.id }], 'test');
    await b.importSyncRecords(await a.allSyncRecords());
    expect(await b.categories()).toEqual([category]);
    const hidden = await a.update((await a.get(wp().id))!, { hidden: true });
    const catHidden = await a.updateCategory(category, { hidden: true });
    await b.importSyncRecords(await a.allSyncRecords());
    await b.importSyncRecords([{ ...hidden, hidden: false, updatedAt: 1 }, category]);
    expect(await b.get(hidden.id)).toEqual(hidden);
    expect(await b.categories()).toEqual([catHidden]);
    expect(isVisible(hidden, [catHidden])).toBe(false);
    await a.removeCategory(category.id);
    await b.importSyncRecords(await a.allSyncRecords());
    expect(await b.categories()).toEqual([]);
    expect(categoryOf(hidden, await b.categories())).toBeUndefined();
    expect(categoryOf({ ...hidden, categoryId: 'unknown-id' }, [])).toBeUndefined();
    expect(await b.get(hidden.id)).toEqual(hidden);
    const tombstone = (await b.allSyncRecords()).find(r => r.id === category.id)!;
    await b.importSyncRecords([{ ...category, updatedAt: tombstone.updatedAt }]);
    expect(await b.categories()).toEqual([]);
    expect(await b.pending()).toHaveLength(0);
  });
  it('resolves portable category names and deletes category items only when requested', async () => {
    const repo = await fresh();
    await repo.importItems([{ ...wp(), categoryName: 'Camp' }, { ...trk(), categoryName: 'camp' }], 'share');
    expect(await repo.categories()).toHaveLength(1);
    const category = (await repo.categories())[0]!;
    expect((await repo.list()).every(i => i.categoryId === category.id && !i.categoryName)).toBe(true);
    await repo.removeCategory(category.id, true);
    expect(await repo.list()).toEqual([]);
  });
});

it('retains organization edits when a recorder saves coordinates from an older snapshot', async () => {
  const repo = await fresh();
  await repo.importItems([trk()], 'recording');
  await repo.update(trk(), { categoryId: 'category-123', hidden: true });
  const updated = await repo.update(trk(), { coords: [[-90, 44], [-90.1, 44.1]] });
  expect(updated).toMatchObject({ categoryId: 'category-123', hidden: true, coords: [[-90, 44], [-90.1, 44.1]] });
});

it('serializes simultaneous recorder and organization patches without losing either', async () => {
  const repo = await fresh();
  await repo.importItems([trk()], 'recording');
  await Promise.all([repo.update(trk(), { categoryId: 'category-123' }), repo.update(trk(), { hidden: true }), repo.update(trk(), { coords: [[-90, 44], [-91, 45]] })]);
  expect(await repo.get(trk().id)).toMatchObject({ categoryId: 'category-123', hidden: true, coords: [[-90, 44], [-91, 45]] });
});
