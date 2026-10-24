/** Domain model shared by storage, sync, share and UI. */

export const WAYPOINT_ICONS = ['pin', 'stand', 'blood', 'rub', 'camp', 'truck'] as const;
export type WaypointIcon = (typeof WAYPOINT_ICONS)[number];

/** [longitude, latitude] — GeoJSON order everywhere. */
export type LngLat = [number, number];

/** Fields every syncable item carries. See src/sync/merge.ts for conflict rules. */
export interface ItemMeta {
  /** Stable UUID, never changes, shared across devices. */
  id: string;
  /** Epoch ms when first created. */
  createdAt: number;
  /** Hybrid-logical-clock timestamp (epoch ms, strictly increasing per device). */
  updatedAt: number;
  /** Device that made the latest write. Tiebreaker for equal updatedAt. */
  deviceId: string;
  /** Tombstone: deleted items are kept so deletes propagate. */
  deleted: boolean;
}

export interface Waypoint extends ItemMeta {
  kind: 'waypoint';
  name: string;
  note: string;
  icon: WaypointIcon;
  coord: LngLat;
  sourceUrl?: string;
}

export interface Track extends ItemMeta {
  kind: 'track';
  name: string;
  note: string;
  coords: LngLat[];
  /** True when recorded from GPS rather than drawn. */
  recorded: boolean;
}

export type Item = Waypoint | Track;
export type ItemKind = Item['kind'];
