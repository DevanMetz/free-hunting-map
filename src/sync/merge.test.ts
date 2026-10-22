import { describe, expect, it } from 'vitest';
import type { Item } from '../types';
import { rng, sortById, trk, wp } from '../test/fixtures';
import { HybridClock } from './hlc';
import { canonicalJson, compareVersions, mergeItem, mergeSets } from './merge';

describe('mergeItem', () => {
  it('takes incoming when nothing local', () => {
    const a = wp();
    expect(mergeItem(undefined, a)).toBe(a);
  });

  it('later updatedAt wins regardless of argument order', () => {
    const old = wp({ name: 'old', updatedAt: 1 });
    const neu = wp({ name: 'new', updatedAt: 2 });
    expect(mergeItem(old, neu)).toBe(neu);
    expect(mergeItem(neu, old)).toBe(neu);
  });

  it('deviceId breaks updatedAt ties deterministically', () => {
    const a = wp({ name: 'a', deviceId: 'aaa' });
    const b = wp({ name: 'b', deviceId: 'bbb' });
    expect(mergeItem(a, b)).toBe(b);
    expect(mergeItem(b, a)).toBe(b);
  });

  it('tombstone wins a tie on updatedAt even against a higher deviceId', () => {
    const live = wp({ deviceId: 'zzz' });
    const dead = wp({ deviceId: 'aaa', deleted: true });
    expect(mergeItem(live, dead)).toBe(dead);
    expect(mergeItem(dead, live)).toBe(dead);
  });

  it('a newer edit resurrects over an older tombstone', () => {
    const dead = wp({ deleted: true, updatedAt: 5 });
    const edit = wp({ name: 'restored', updatedAt: 6 });
    expect(mergeItem(dead, edit)).toBe(edit);
  });

  it('is idempotent', () => {
    const a = wp();
    expect(mergeItem(a, a)).toBe(a);
    expect(mergeItem(a, { ...a })).toBe(a);
  });

  it('identical metadata with different content still resolves deterministically', () => {
    const a = wp({ name: 'x' });
    const b = wp({ name: 'y' });
    expect(mergeItem(a, b)).toBe(mergeItem(b, a) === a ? a : b);
    expect(compareVersions(a, b)).toBe(-compareVersions(b, a));
  });

  it('rejects merging different ids', () => {
    expect(() => mergeItem(wp(), wp({ id: 'other-id-123' }))).toThrow();
  });
});

describe('mergeSets', () => {
  it('reports only items that changed local state', () => {
    const local = [wp({ updatedAt: 10 }), trk({ updatedAt: 10 })];
    const incoming = [wp({ updatedAt: 5, name: 'stale' }), trk({ updatedAt: 11, name: 'fresh' })];
    const { changed, merged } = mergeSets(local, incoming);
    expect(changed.map((i) => i.name)).toEqual(['fresh']);
    expect(merged.get(wp().id)?.updatedAt).toBe(10);
  });

  it('re-importing the same batch is a no-op', () => {
    const batch = [wp(), trk()];
    const first = mergeSets([], batch);
    const second = mergeSets(first.merged.values(), batch);
    expect(second.changed).toEqual([]);
  });

  it('is commutative, associative and idempotent over random version histories', () => {
    const r = rng(42);
    const ids = ['aaaaaaaa-0', 'bbbbbbbb-1', 'cccccccc-2', 'dddddddd-3'];
    const devices = ['dev-1', 'dev-2', 'dev-3'];
    const versions: Item[] = [];
    for (let n = 0; n < 200; n++) {
      versions.push(
        wp({
          id: ids[Math.floor(r() * ids.length)]!,
          updatedAt: 1000 + Math.floor(r() * 20),
          deviceId: devices[Math.floor(r() * devices.length)]!,
          deleted: r() < 0.25,
          name: `v${Math.floor(r() * 3)}`,
        }),
      );
    }
    const canonical = (items: Iterable<Item>): string => canonicalJson(sortById(items));
    const expected = canonical(mergeSets([], versions).merged.values());

    for (let trial = 0; trial < 30; trial++) {
      const shuffled = [...versions].sort(() => r() - 0.5);
      const cut = Math.floor(r() * shuffled.length);
      // Split into two replicas, merge each side, then merge replicas both ways.
      const left = mergeSets([], shuffled.slice(0, cut)).merged;
      const right = mergeSets([], shuffled.slice(cut)).merged;
      const lr = mergeSets(left.values(), right.values()).merged;
      const rl = mergeSets(right.values(), left.values()).merged;
      expect(canonical(lr.values())).toBe(expected);
      expect(canonical(rl.values())).toBe(expected);
      // Idempotent: merging the result into itself changes nothing.
      expect(mergeSets(lr.values(), lr.values()).changed).toEqual([]);
    }
  });
});

describe('HybridClock', () => {
  it('is strictly monotonic even when the wall clock stalls or goes backwards', () => {
    let wall = 1000;
    const clock = new HybridClock(() => wall);
    const a = clock.now();
    const b = clock.now();
    wall = 500;
    const c = clock.now();
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it('moves past observed remote timestamps so local edits win', () => {
    const clock = new HybridClock(() => 1000);
    clock.observe(5000);
    expect(clock.now()).toBeGreaterThan(5000);
  });
});
