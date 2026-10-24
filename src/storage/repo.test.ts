import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { trk, wp } from '../test/fixtures';
import type { Waypoint } from '../types';
import { Repo } from './repo';

let n = 0;
const fresh = (): Promise<Repo> => Repo.open(`test-${n++}`);

describe('Repo (IndexedDB)', () => {
  it('stamps local writes and queues them in the outbox', async () => {
    const repo = await fresh();
    const a = await repo.create<Waypoint>({ kind: 'waypoint', name: 'Stand', note: '', icon: 'stand', coord: [-90, 44] });
    expect(a.deviceId).toBe(repo.deviceId);
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
    const b = await repo.update(a, { name: 'North stand' });
    expect(b.updatedAt).toBeGreaterThan(a.updatedAt);
    const pending = await repo.pending();
    expect(pending).toHaveLength(1);
    expect((pending[0]!.item as Waypoint).name).toBe('North stand');
    await repo.ack(pending);
    expect(await repo.pending()).toHaveLength(0);
  });

  it('delete leaves a tombstone', async () => {
    const repo = await fresh();
    const a = await repo.create<Waypoint>({ kind: 'waypoint', name: '', note: '', icon: 'pin', coord: [0, 0] });
    await repo.remove(a.id);
    expect(await repo.list()).toHaveLength(0);
    expect((await repo.get(a.id))?.deleted).toBe(true);
  });

  it('imports merge and re-imports are no-ops', async () => {
    const repo = await fresh();
    const items = [wp(), trk()];
    expect(await repo.importItems(items, 'test')).toEqual({ received: 2, changed: 2 });
    expect(await repo.importItems(items, 'test')).toEqual({ received: 2, changed: 0 });
    // A local edit after import must beat the imported version.
    const local = (await repo.get(wp().id))!;
    const edited = await repo.update(local, { name: 'mine' });
    expect(edited.updatedAt).toBeGreaterThan(wp().updatedAt);
    expect(await repo.importItems([wp()], 'test')).toEqual({ received: 1, changed: 0 });
    expect((await repo.get(wp().id))?.name).toBe('mine');
  });

  it('keeps the same deviceId across opens', async () => {
    const name = `test-device-${n++}`;
    const a = await Repo.open(name);
    const b = await Repo.open(name);
    expect(a.deviceId).toBe(b.deviceId);
  });
});

describe('cloud records', () => {
  it('syncs portable preferences while keeping camera and cache local', async () => {
    const a = await fresh(), b = await fresh();
    await b.setMeta('settings', { view: { zoom: 2 } });
    a.clock.observe(b.clock.now());
    await a.setMeta('settings', { basemap: 'satellite', labels: false, view: { zoom: 9 }, cache: 'secret' });
    const pending = await a.pending();
    expect(pending[0]!.item).toMatchObject({ kind: 'settings', preferences: { basemap: 'satellite', labels: false } });
    expect(JSON.stringify(pending[0]!.item)).not.toContain('secret');
    await b.ack(await b.pending());
    let notified = false;
    b.addEventListener('preferences', () => { notified = true; });
    await b.importSyncRecords(pending.map(e => e.item));
    expect(await b.getMeta('settings')).toEqual({ basemap: 'satellite', labels: false, view: { zoom: 2 } });
    expect(notified).toBe(true);
    expect(await b.pending()).toHaveLength(0);
  });

  it('propagates saved trail candidates and their deletion', async () => {
    const a = await fresh(), b = await fresh();
    await a.saveLidarRun({ box: [-90, 40, -89, 41], candidates: { type: 'FeatureCollection', features: [] } });
    await b.importSyncRecords((await a.pending()).map(e => e.item));
    expect(await b.listLidarRuns()).toHaveLength(1);
    await a.clearLidarRuns();
    await b.importSyncRecords((await a.pending()).map(e => e.item));
    expect(await b.listLidarRuns()).toHaveLength(0);
    expect((await b.allSyncRecords())[0]!.deleted).toBe(true);
  });

  it('never acknowledges a newer write using an old snapshot', async () => {
    const repo = await fresh();
    const a = await repo.create<Waypoint>({ kind: 'waypoint', name: '', note: '', icon: 'pin', coord: [0, 0] });
    const pending = await repo.pending();
    await repo.update(a, { name: 'new' });
    await repo.ack(pending);
    expect(await repo.pending()).toHaveLength(1);
  });

  it('keeps cloud ownership across logout and rejects switching accounts', async () => {
    const repo = await fresh();
    await repo.bindSyncAccount('alice');
    await repo.bindSyncAccount('alice');
    await expect(repo.bindSyncAccount('bob')).rejects.toThrow('separate browser profile');
    expect(await repo.getMeta('cloud.owner')).toBe('alice');
  });
});

it('does not emit change for empty or repeated cloud responses', async () => {
  const repo = await fresh();
  let events = 0;
  repo.addEventListener('change', () => { events++; });
  await repo.importSyncRecords([]);
  expect(events).toBe(0);
  await repo.importSyncRecords([wp()]);
  expect(events).toBe(1);
  await repo.importSyncRecords([wp()]);
  await repo.importSyncRecords([]);
  expect(events).toBe(1);
});
