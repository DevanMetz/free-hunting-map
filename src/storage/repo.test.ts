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
    expect(pending[0]!.item.name).toBe('North stand');
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
