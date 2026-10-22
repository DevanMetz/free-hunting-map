import type { Item, Track, Waypoint } from '../types';

export function wp(overrides: Partial<Waypoint> = {}): Waypoint {
  return {
    kind: 'waypoint',
    id: '11111111-1111-4111-8111-111111111111',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    deviceId: 'device-a',
    deleted: false,
    name: 'Big buck',
    note: 'Last seen heading north',
    icon: 'blood',
    coord: [-90.123456, 44.654321],
    ...overrides,
  };
}

export function trk(overrides: Partial<Track> = {}): Track {
  return {
    kind: 'track',
    id: '22222222-2222-4222-8222-222222222222',
    createdAt: 1_700_000_100_000,
    updatedAt: 1_700_000_200_000,
    deviceId: 'device-b',
    deleted: false,
    name: 'Blood trail',
    note: '',
    coords: [
      [-90.1, 44.6],
      [-90.100512, 44.600321],
      [-90.101003, 44.600888],
    ],
    recorded: true,
    ...overrides,
  };
}

/** Deterministic PRNG for property-style tests. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sortById(items: Iterable<Item>): Item[] {
  return [...items].sort((a, b) => (a.id < b.id ? -1 : 1));
}
